<?php
// A stand-in WordPress admin for test/wp-admin.test.js, run with PHP's
// built-in server: Settings › JARchat at any path, and admin-ajax.php.
// JARCHAT_SETUP is the setup page's address; JARCHAT_STATE a file that keeps
// the saved option between requests.

define('JARCHAT_SETUP_URL', getenv('JARCHAT_SETUP'));
require __DIR__ . '/wp-stubs.php';
require __DIR__ . '/../wordpress/jarchat/jarchat.php';

$state = getenv('JARCHAT_STATE');
$GLOBALS['options'] = is_file($state) ? json_decode(file_get_contents($state), true) : array();
$GLOBALS['admin'] = true;
call_user_func($GLOBALS['actions']['admin_init']);

if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/wp-admin/admin-ajax.php') {
	// WordPress hands plugins $_POST with slashes added.
	$_POST = array_map('addslashes', $_POST);
	$_REQUEST = $_POST;
	try {
		call_user_func($GLOBALS['actions']['wp_ajax_' . $_POST['action']]);
	} catch (WPStubJson $r) {
		file_put_contents($state, json_encode($GLOBALS['options']));
		http_response_code($r->status);
		header('Content-Type: application/json');
		echo json_encode($r->body);
	}
	return true;
}

echo '<!doctype html><html><head><meta charset="utf-8"><title>JARchat ‹ Settings</title></head><body>';
jarchat_settings_page();
echo '</body></html>';
