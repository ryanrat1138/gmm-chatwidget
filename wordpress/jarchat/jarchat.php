<?php
/**
 * Plugin Name:       JARchat
 * Description:       Join. Answer. Relay. Adds the JARchat AI chat to form thank-you pages with a shortcode. Paste the code from the JARchat setup page once under Settings › JARchat, then put [jarchat] on the thank-you page.
 * Version:           1.0.0
 * Requires at least: 5.7
 * Requires PHP:      7.2
 * Author:            Great Mountain Marketing
 * Text Domain:       jarchat
 */

if (!defined('ABSPATH')) {
	exit;
}

define('JARCHAT_VERSION', '1.0.0');
define('JARCHAT_OPTION', 'jarchat_settings');
define('JARCHAT_SETUP_URL', 'https://gmm-chatwidget.vercel.app/');

/**
 * Reads a pasted <script> tag into its src and data-* attributes, so the
 * plugin stores values, never raw HTML. Returns null when there is no usable
 * JARchat tag: the src must be an https URL ending in /chat.js or /embed.js.
 */
function jarchat_parse_tag($code) {
	$code = trim((string) $code);
	// The opening tag ends at the first > outside quotes: attribute values
	// (formatted call-to-action text) can hold a >.
	if ($code === '' || !preg_match('/<script\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>/i', $code, $m)) {
		return null;
	}
	preg_match_all('/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/', $m[1], $pairs, PREG_SET_ORDER);
	$src = '';
	$data = array();
	foreach ($pairs as $p) {
		$name = strtolower($p[1]);
		$value = html_entity_decode(isset($p[3]) && $p[3] !== '' ? $p[3] : $p[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
		if ($name === 'src') {
			$src = trim($value);
		} elseif (strpos($name, 'data-') === 0 && preg_match('/^data-[a-z0-9-]+$/', $name)) {
			$data[substr($name, 5)] = $value;
		}
	}
	if (!jarchat_valid_src($src)) {
		return null;
	}
	return array('src' => $src, 'data' => $data);
}

function jarchat_valid_src($src) {
	$parts = wp_parse_url($src);
	return is_array($parts)
		&& isset($parts['scheme'], $parts['host'], $parts['path'])
		&& $parts['scheme'] === 'https'
		&& preg_match('~/(chat|embed)\.js$~', $parts['path']);
}

/** Builds the tag back from stored values; every value is escaped. */
function jarchat_render_tag($tag, $overrides) {
	if (!$tag) {
		return '';
	}
	$data = $tag['data'];
	foreach ((array) $overrides as $key => $value) {
		$key = strtolower((string) $key);
		if (preg_match('/^[a-z][a-z0-9-]*$/', $key)) {
			$data[$key] = (string) $value;
		}
	}
	$attrs = array('src' => $tag['src']);
	foreach ($data as $key => $value) {
		$attrs['data-' . $key] = $value;
	}
	// Ask script optimizers (Cloudflare Rocket Loader, LiteSpeed and others)
	// to leave the tag where it is: the chat appears where the tag sits.
	$attrs['data-cfasync'] = 'false';
	$attrs['data-no-optimize'] = '1';
	$attrs['data-no-defer'] = '1';
	$html = '<script';
	foreach ($attrs as $name => $value) {
		$html .= ' ' . $name . '="' . esc_attr($value) . '"';
	}
	return $html . '></script>';
}

function jarchat_settings() {
	$saved = get_option(JARCHAT_OPTION, array());
	return wp_parse_args(is_array($saved) ? $saved : array(), array(
		'chat_code' => '',
		'chat_tag'  => null,
		'form_code' => '',
		'form_tag'  => null,
	));
}

/** Shortcode attributes become data-* attributes: [jarchat layout="bubble"]. */
function jarchat_overrides($atts) {
	return is_array($atts) ? $atts : array();
}

function jarchat_shortcode($atts) {
	$s = jarchat_settings();
	if (!$s['chat_tag']) {
		return current_user_can('manage_options')
			? '<p><em>' . esc_html__('JARchat: paste your thank-you page code under Settings › JARchat.', 'jarchat') . '</em></p>'
			: '';
	}
	return jarchat_render_tag($s['chat_tag'], jarchat_overrides($atts));
}
add_shortcode('jarchat', 'jarchat_shortcode');

function jarchat_form_shortcode($atts) {
	$s = jarchat_settings();
	if (!$s['form_tag']) {
		return current_user_can('manage_options')
			? '<p><em>' . esc_html__('JARchat: paste your form page code under Settings › JARchat.', 'jarchat') . '</em></p>'
			: '';
	}
	return jarchat_render_tag($s['form_tag'], jarchat_overrides($atts));
}
add_shortcode('jarchat_form', 'jarchat_form_shortcode');

// ---------- settings page ----------

function jarchat_sanitize($input) {
	$input = is_array($input) ? $input : array();
	$out = array();
	foreach (array('chat', 'form') as $kind) {
		$code = isset($input[$kind . '_code']) ? trim(wp_unslash($input[$kind . '_code'])) : '';
		$tag = jarchat_parse_tag($code);
		if ($code !== '' && !$tag) {
			add_settings_error(JARCHAT_OPTION, 'jarchat-' . $kind,
				$kind === 'chat'
					? __('The thank-you page code isn’t a JARchat script tag. Copy it again from the setup page.', 'jarchat')
					: __('The form page code isn’t a JARchat script tag. Copy it again from the setup page.', 'jarchat'));
		}
		if ($kind === 'chat' && $tag && empty($tag['data']['source'])) {
			add_settings_error(JARCHAT_OPTION, 'jarchat-source',
				__('The thank-you page code has no source ID, so no chat will show. Finish step 1 on the setup page and copy it again.', 'jarchat'), 'warning');
		}
		// Keep the pasted text only as a reminder in the box; the page uses the parsed tag.
		$out[$kind . '_code'] = $tag ? jarchat_render_tag($tag, array()) : '';
		$out[$kind . '_tag'] = $tag;
	}
	return $out;
}

function jarchat_admin_init() {
	register_setting('jarchat', JARCHAT_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => 'jarchat_sanitize',
		'default'           => array(),
	));
}
add_action('admin_init', 'jarchat_admin_init');

function jarchat_admin_menu() {
	add_options_page('JARchat', 'JARchat', 'manage_options', 'jarchat', 'jarchat_settings_page');
}
add_action('admin_menu', 'jarchat_admin_menu');

function jarchat_settings_link($links) {
	array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=jarchat')) . '">' . esc_html__('Settings', 'jarchat') . '</a>');
	return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'jarchat_settings_link');

function jarchat_settings_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$s = jarchat_settings();
	$name = JARCHAT_OPTION;
	?>
	<div class="wrap">
		<h1>JARchat</h1>
		<p><strong><?php esc_html_e('Join. Answer. Relay.', 'jarchat'); ?></strong></p>
		<p><?php
			printf(
				/* translators: %s: link to the setup page */
				esc_html__('Build your code on the %s, then paste it here. Each page then only needs a shortcode.', 'jarchat'),
				'<a href="' . esc_url(JARCHAT_SETUP_URL) . '" target="_blank" rel="noopener">' . esc_html__('JARchat setup page', 'jarchat') . '</a>'
			);
		?></p>
		<?php settings_errors(JARCHAT_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('jarchat'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="jarchat-chat"><?php esc_html_e('Thank-you page code', 'jarchat'); ?></label></th>
					<td>
						<textarea id="jarchat-chat" name="<?php echo esc_attr($name); ?>[chat_code]" rows="8" class="large-text code" spellcheck="false"><?php echo esc_textarea($s['chat_code']); ?></textarea>
						<p class="description"><?php esc_html_e('From step 4 of the setup page: “Thank-you page code”.', 'jarchat'); ?></p>
						<?php jarchat_status($s['chat_tag'], '[jarchat]', __('on the thank-you page, where the chat or its card should appear', 'jarchat')); ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="jarchat-form"><?php esc_html_e('Form page code', 'jarchat'); ?> <span class="description">(<?php esc_html_e('optional', 'jarchat'); ?>)</span></label></th>
					<td>
						<textarea id="jarchat-form" name="<?php echo esc_attr($name); ?>[form_code]" rows="3" class="large-text code" spellcheck="false"><?php echo esc_textarea($s['form_code']); ?></textarea>
						<p class="description"><?php esc_html_e('Only when the form is on this site, including a HighLevel form embedded here. Not needed for Typeform or HighLevel funnel forms.', 'jarchat'); ?></p>
						<?php jarchat_status($s['form_tag'], '[jarchat_form]', __('on the page with the form', 'jarchat')); ?>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2><?php esc_html_e('Changing one page', 'jarchat'); ?></h2>
		<p><?php esc_html_e('Any setting from the code can be changed for a single page in the shortcode, without the data- part. For example:', 'jarchat'); ?></p>
		<p><code>[jarchat layout="bubble"]</code> &nbsp; <code>[jarchat cta="off"]</code> &nbsp; <code>[jarchat greeting="Hi {first_name}!"]</code></p>
	</div>
	<?php
}

function jarchat_status($tag, $shortcode, $where) {
	if (!$tag) {
		return;
	}
	echo '<p>' . sprintf(
		/* translators: 1: shortcode, 2: where it goes */
		esc_html__('Saved. Add %1$s %2$s.', 'jarchat'),
		'<code>' . esc_html($shortcode) . '</code>',
		esc_html($where)
	) . '</p>';
}
