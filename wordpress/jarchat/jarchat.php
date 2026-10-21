<?php
/**
 * Plugin Name:       JARchat
 * Description:       Join. Answer. Relay. Adds the JARchat AI chat to form thank-you pages with a shortcode. Set it up under Settings › JARchat, then put [jarchat] on the thank-you page.
 * Version:           1.1.0
 * Requires at least: 5.7
 * Requires PHP:      7.2
 * Author:            Great Mountain Marketing
 * Text Domain:       jarchat
 */

if (!defined('ABSPATH')) {
	exit;
}

define('JARCHAT_VERSION', '1.1.0');
define('JARCHAT_OPTION', 'jarchat_settings');
if (!defined('JARCHAT_SETUP_URL')) {
	define('JARCHAT_SETUP_URL', 'https://gmm-chatwidget.vercel.app/');
}

/**
 * Reads a pasted <script> tag into its src and data-* attributes, so the
 * plugin stores values, never raw HTML. Returns null when there is no usable
 * JARchat tag: the src must be an https URL ending in /chat.js or /embed.js.
 * A <style> block after it (the setup page's custom CSS) is kept as css.
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
	$tag = array('src' => $src, 'data' => $data);
	if (preg_match('~<style\b[^>]*>(.*?)</style\s*>~is', $code, $style) && trim($style[1]) !== '') {
		$tag['css'] = trim($style[1]);
	}
	return $tag;
}

function jarchat_valid_src($src) {
	$parts = wp_parse_url($src);
	return is_array($parts)
		&& isset($parts['scheme'], $parts['host'], $parts['path'])
		// http only for a copy of the setup page running on this computer.
		&& ($parts['scheme'] === 'https' || ($parts['scheme'] === 'http' && in_array($parts['host'], array('localhost', '127.0.0.1'), true)))
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
	$html .= '></script>';
	if (!empty($tag['css'])) {
		// A < can't end the block early: in CSS, \3c is the same character.
		$html .= "\n<style>\n" . str_replace('<', '\\3c ', $tag['css']) . "\n</style>";
	}
	return $html;
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

/**
 * Checks pasted or sent code. Returns the settings to store and any messages,
 * each array(code, text, 'error'|'warning').
 */
function jarchat_check($input) {
	$input = is_array($input) ? $input : array();
	$out = array();
	$messages = array();
	foreach (array('chat', 'form') as $kind) {
		$code = isset($input[$kind . '_code']) ? trim((string) $input[$kind . '_code']) : '';
		$tag = jarchat_parse_tag($code);
		if ($code !== '' && !$tag) {
			$messages[] = array('jarchat-' . $kind,
				$kind === 'chat'
					? __('The thank-you page code isn’t a JARchat script tag. Copy it again from the setup page.', 'jarchat')
					: __('The form page code isn’t a JARchat script tag. Copy it again from the setup page.', 'jarchat'),
				'error');
		}
		if ($kind === 'chat' && $tag && empty($tag['data']['source'])) {
			$messages[] = array('jarchat-source',
				__('The thank-you page code has no source ID, so no chat will show. Finish step 1 on the setup page and save again.', 'jarchat'),
				'warning');
		}
		// Keep the code only as a reminder in the box; the page uses the parsed tag.
		$out[$kind . '_code'] = $tag ? jarchat_render_tag($tag, array()) : '';
		$out[$kind . '_tag'] = $tag;
	}
	return array($out, $messages);
}

/** The settings form's sanitize callback. WordPress has already unslashed the input. */
function jarchat_sanitize($input) {
	list($out, $messages) = jarchat_check($input);
	foreach ($messages as $m) {
		add_settings_error(JARCHAT_OPTION, $m[0], $m[1], $m[2]);
	}
	return $out;
}

/**
 * Saves the code the setup page sends from its frame on Settings › JARchat
 * ("Save to WordPress"). Leaving out form_code keeps the saved one.
 */
function jarchat_ajax_save() {
	check_ajax_referer('jarchat_save');
	if (!current_user_can('manage_options')) {
		wp_send_json_error(array('message' => __('Only an administrator can save JARchat settings.', 'jarchat')), 403);
	}
	$saved = jarchat_settings();
	$input = array(
		'chat_code' => isset($_POST['chat_code']) ? wp_unslash($_POST['chat_code']) : '',
		'form_code' => isset($_POST['form_code']) ? wp_unslash($_POST['form_code']) : $saved['form_code'],
	);
	list($out, $messages) = jarchat_check($input);
	foreach ($messages as $m) {
		if ($m[2] === 'error') {
			wp_send_json_error(array('message' => $m[1]));
		}
	}
	update_option(JARCHAT_OPTION, $out);
	$text = $out['form_tag'] && isset($_POST['form_code'])
		? __('Saved. Now put [jarchat] on the thank-you page and [jarchat_form] on the form page.', 'jarchat')
		: __('Saved. Now put [jarchat] on the thank-you page.', 'jarchat');
	foreach ($messages as $m) {
		$text .= ' ' . $m[1];
	}
	wp_send_json_success(array(
		'message'   => $text,
		'warning'   => !empty($messages),
		'chat_code' => $out['chat_code'],
		'form_code' => $out['form_code'],
	));
}
add_action('wp_ajax_jarchat_save', 'jarchat_ajax_save');

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
		<p><strong><?php esc_html_e('Join. Answer. Relay.', 'jarchat'); ?></strong> <?php esc_html_e('Work through the setup below and click “Save to WordPress” at the last step. Each page then only needs a shortcode.', 'jarchat'); ?></p>
		<?php settings_errors(JARCHAT_OPTION); ?>
		<div id="jarchat-saved"><?php jarchat_status($s['chat_tag'], '[jarchat]', __('on the thank-you page, where the chat or its card should appear', 'jarchat')); ?></div>
		<iframe id="jarchat-wizard" title="<?php esc_attr_e('JARchat setup', 'jarchat'); ?>" allow="clipboard-write" style="display:block;width:100%;height:max(640px,calc(100vh - 240px));margin:16px 0 20px;border:1px solid #c3c4c7;border-radius:8px;background:#fff"></iframe>
		<details<?php echo $s['chat_tag'] ? '' : ' open'; ?> id="jarchat-manual">
			<summary><strong><?php esc_html_e('Saved code', 'jarchat'); ?></strong> &nbsp;<span class="description"><?php esc_html_e('or paste code from the setup page yourself', 'jarchat'); ?></span></summary>
			<form method="post" action="options.php">
				<?php settings_fields('jarchat'); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="jarchat-chat"><?php esc_html_e('Thank-you page code', 'jarchat'); ?></label></th>
						<td>
							<textarea id="jarchat-chat" name="<?php echo esc_attr($name); ?>[chat_code]" rows="8" class="large-text code" spellcheck="false"><?php echo esc_textarea($s['chat_code']); ?></textarea>
							<p class="description"><?php esc_html_e('From the last step of the setup page: “Thank-you page code”.', 'jarchat'); ?></p>
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
		</details>
		<h2><?php esc_html_e('Changing one page', 'jarchat'); ?></h2>
		<p><?php esc_html_e('Any setting from the code can be changed for a single page in the shortcode, without the data- part. For example:', 'jarchat'); ?></p>
		<p><code>[jarchat layout="bubble"]</code> &nbsp; <code>[jarchat cta="off"]</code> &nbsp; <code>[jarchat greeting="Hi {first_name}!"]</code></p>
	</div>
	<?php
	jarchat_wizard_script();
}

/**
 * Loads the hosted setup page into the frame and saves what its
 * "Save to WordPress" button sends. Only messages from that frame, at the
 * setup page's own address, are listened to.
 */
function jarchat_wizard_script() {
	$config = array(
		'setup' => JARCHAT_SETUP_URL,
		'ajax'  => admin_url('admin-ajax.php'),
		'nonce' => wp_create_nonce('jarchat_save'),
		'fail'  => __('Couldn’t reach WordPress. Check you’re still logged in, reload this page and try again.', 'jarchat'),
	);
	$js = 'var JARCHAT = ' . wp_json_encode($config) . ";\n" . <<<'JS'
(function () {
  var frame = document.getElementById('jarchat-wizard');
  var setupOrigin = new URL(JARCHAT.setup, location.href).origin;
  frame.src = JARCHAT.setup + (JARCHAT.setup.indexOf('?') === -1 ? '?' : '&') + 'wp=' + encodeURIComponent(location.origin);
  function answer(ok, message) {
    frame.contentWindow.postMessage({ type: 'jarchat:saved', ok: ok, message: message }, setupOrigin);
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== setupOrigin || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.type !== 'jarchat:save' || typeof d.chat !== 'string') return;
    var body = new FormData();
    body.append('action', 'jarchat_save');
    body.append('_ajax_nonce', JARCHAT.nonce);
    body.append('chat_code', d.chat);
    if (typeof d.form === 'string') body.append('form_code', d.form);
    fetch(JARCHAT.ajax, { method: 'POST', body: body, credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (r) {
        var data = (r && r.data) || {};
        if (!r || !r.success) return answer(false, data.message || JARCHAT.fail);
        document.getElementById('jarchat-chat').value = data.chat_code;
        document.getElementById('jarchat-form').value = data.form_code;
        var note = document.getElementById('jarchat-saved');
        note.innerHTML = '';
        var p = document.createElement('p');
        p.className = 'notice inline ' + (data.warning ? 'notice-warning' : 'notice-success');
        p.style.padding = '8px 12px';
        p.textContent = data.message;
        note.appendChild(p);
        answer(true, data.message);
      })['catch'](function () { answer(false, JARCHAT.fail); });
  });
})();
JS;
	wp_print_inline_script_tag($js);
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
