<?php
// The few WordPress functions the JARchat plugin uses, stubbed for
// test/wordpress.test.php and test/wp-admin-server.php.

if (!defined('ABSPATH')) {
	define('ABSPATH', __DIR__);
}
$GLOBALS['options'] = array();
$GLOBALS['shortcodes'] = array();
$GLOBALS['actions'] = array();
$GLOBALS['sanitizers'] = array();
$GLOBALS['errors'] = array();
$GLOBALS['admin'] = false;

class WPStubJson extends Exception {
	public $body;
	public $status;
	public function __construct($body, $status) { parent::__construct('json'); $this->body = $body; $this->status = $status; }
}

function add_shortcode($tag, $fn) { $GLOBALS['shortcodes'][$tag] = $fn; }
function add_action($hook, $fn) { $GLOBALS['actions'][$hook] = $fn; }
function add_filter() {}
function register_setting($group, $name, $args) { $GLOBALS['sanitizers'][$name] = $args['sanitize_callback']; }
function add_options_page() {}
function plugin_basename($f) { return basename(dirname($f)) . '/' . basename($f); }
function get_option($k, $d = false) { return isset($GLOBALS['options'][$k]) ? $GLOBALS['options'][$k] : $d; }
function update_option($k, $v) {
	// As in WordPress, a registered setting's sanitize callback runs on every save.
	if (isset($GLOBALS['sanitizers'][$k])) {
		$v = call_user_func($GLOBALS['sanitizers'][$k], $v);
	}
	$GLOBALS['options'][$k] = $v;
	return true;
}
function wp_parse_args($a, $d) { return array_merge($d, $a); }
function wp_parse_url($u) { return parse_url($u); }
function wp_unslash($v) { return stripslashes($v); }
function wp_json_encode($v) { return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP); }
function esc_attr($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
function esc_html($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
function esc_textarea($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
function esc_url($v) { return esc_attr($v); }
function esc_html__($v) { return esc_html($v); }
function esc_html_e($v) { echo esc_html($v); }
function esc_attr_e($v) { echo esc_attr($v); }
function __($v) { return $v; }
function admin_url($p = '') { return '/wp-admin/' . $p; }
function current_user_can() { return $GLOBALS['admin']; }
function add_settings_error($setting, $code, $msg, $type = 'error') { $GLOBALS['errors'][] = array($code, $type); }
function settings_errors() {}
function settings_fields() { echo '<input type="hidden" name="option_page" value="jarchat">'; }
function submit_button() { echo '<p class="submit"><input type="submit" class="button button-primary" value="Save Changes"></p>'; }
function wp_create_nonce($a) { return 'nonce-' . $a; }
function check_ajax_referer($a) {
	if (!isset($_REQUEST['_ajax_nonce']) || $_REQUEST['_ajax_nonce'] !== wp_create_nonce($a)) {
		throw new WPStubJson('-1', 403);
	}
}
function wp_send_json_success($data) { throw new WPStubJson(array('success' => true, 'data' => $data), 200); }
function wp_send_json_error($data, $status = 200) { throw new WPStubJson(array('success' => false, 'data' => $data), $status); }
function wp_print_inline_script_tag($js) { echo "<script>\n" . $js . "\n</script>\n"; }
