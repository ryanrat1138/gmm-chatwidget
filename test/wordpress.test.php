<?php
// Tests for the WordPress plugin, with the WordPress functions it uses
// stubbed (test/wp-stubs.php). Run with: php test/wordpress.test.php

require __DIR__ . '/wp-stubs.php';
require __DIR__ . '/../wordpress/jarchat/jarchat.php';

$failed = 0;
$passed = 0;
function test($name, $fn) {
	global $failed, $passed;
	$GLOBALS['errors'] = array();
	try {
		$fn();
		$passed++;
		echo "ok   - $name\n";
	} catch (Throwable $e) {
		$failed++;
		echo "FAIL - $name\n       " . $e->getMessage() . "\n";
	}
}
function eq($a, $b, $msg = '') {
	if ($a !== $b) {
		throw new Exception(($msg ? "$msg: " : '') . var_export($a, true) . ' !== ' . var_export($b, true));
	}
}
function shortcode($tag, $atts = '') { return call_user_func($GLOBALS['shortcodes'][$tag], $atts); }

// The code the setup page writes, escaped the way it escapes attributes.
$SETUP_CODE = "<script src=\"https://gmm-chatwidget.vercel.app/chat.js\"\n  data-source=\"4ts0AHLEWQsK5N84\"\n" .
	"  data-greeting=\"Hey {first_name}, I&#39;m here &amp; happy to help.\"\n" .
	"  data-cta-text=\"Hi &lt;strong>{first_name}&lt;/strong> &lt;a href=&quot;https://example.com/a?b=1&amp;c=2&quot;>FAQ&lt;/a>\"\n" .
	"  data-cta-video=\"https://youtu.be/dQw4w9WgXcQ\"></script>";

test('the setup page code is read into its source and settings, decoded', function () use ($SETUP_CODE) {
	$tag = jarchat_parse_tag($SETUP_CODE);
	eq($tag['src'], 'https://gmm-chatwidget.vercel.app/chat.js');
	eq($tag['data']['source'], '4ts0AHLEWQsK5N84');
	eq($tag['data']['greeting'], "Hey {first_name}, I'm here & happy to help.");
	eq($tag['data']['cta-text'], 'Hi <strong>{first_name}</strong> <a href="https://example.com/a?b=1&c=2">FAQ</a>');
	eq($tag['data']['cta-video'], 'https://youtu.be/dQw4w9WgXcQ');
});

test('the tag is written back escaped, and reads back the same', function () use ($SETUP_CODE) {
	$tag = jarchat_parse_tag($SETUP_CODE);
	$html = jarchat_render_tag($tag, array());
	eq(strpos($html, '<script src="https://gmm-chatwidget.vercel.app/chat.js" '), 0);
	eq(strpos($html, '<strong>'), false, 'no raw markup inside attributes');
	eq(substr_count($html, '<'), 2, 'only the opening and closing script tags');
	eq(jarchat_parse_tag($html)['data']['cta-text'], $tag['data']['cta-text']);
	eq(strpos($html, 'data-cfasync="false"') !== false, true, 'asks optimizers to leave it alone');
});

test('only an https JARchat script is accepted', function () {
	eq(jarchat_parse_tag('<script src="http://gmm-chatwidget.vercel.app/chat.js" data-source="x"></script>'), null);
	eq(jarchat_parse_tag('<script src="https://evil.example/steal.js" data-source="x"></script>'), null);
	eq(jarchat_parse_tag('<script>alert(1)</script>'), null);
	eq(jarchat_parse_tag('just some text'), null);
	eq(jarchat_parse_tag('<script src="https://jarchat.app/embed.js"></script>')['src'], 'https://jarchat.app/embed.js');
});

test('[jarchat] prints the saved tag, with per-page overrides escaped', function () use ($SETUP_CODE) {
	$GLOBALS['options']['jarchat_settings'] = jarchat_sanitize(array('chat_code' => $SETUP_CODE, 'form_code' => ''));
	$html = shortcode('jarchat', array('layout' => 'bubble', 'cta' => 'off', 'Bad Key!' => 'x', 'greeting' => '"><script>alert(1)</script>'));
	$tag = jarchat_parse_tag($html);
	eq($tag['data']['layout'], 'bubble');
	eq($tag['data']['cta'], 'off');
	eq($tag['data']['greeting'], '"><script>alert(1)</script>');
	eq(isset($tag['data']['bad key!']), false);
	eq(jarchat_parse_tag(shortcode('jarchat', array(0 => 'bubble')))['data']['0'] ?? null, null, 'a bare word is ignored');
	eq(substr_count($html, '<script'), 1, 'an override cannot add a tag');
	eq(jarchat_parse_tag(shortcode('jarchat'))['data']['layout'] ?? null, null, 'no override, no layout');
});

test('with nothing saved, visitors see nothing and admins see where to set it up', function () {
	$GLOBALS['options']['jarchat_settings'] = array();
	eq(shortcode('jarchat'), '');
	eq(shortcode('jarchat_form'), '');
	$GLOBALS['admin'] = true;
	eq(strpos(shortcode('jarchat'), 'Settings › JARchat') !== false, true);
	$GLOBALS['admin'] = false;
});

test('[jarchat_form] prints the form page tag', function () {
	$GLOBALS['options']['jarchat_settings'] = jarchat_sanitize(array(
		'chat_code' => '',
		'form_code' => '<script src="https://gmm-chatwidget.vercel.app/embed.js" data-fields="business_info"></script>',
	));
	$tag = jarchat_parse_tag(shortcode('jarchat_form'));
	eq($tag['src'], 'https://gmm-chatwidget.vercel.app/embed.js');
	eq($tag['data']['fields'], 'business_info');
});

test('saving: bad code is refused with a message, a missing source warns', function () {
	$out = jarchat_sanitize(array('chat_code' => '<p>hello</p>', 'form_code' => ''));
	eq($out['chat_tag'], null);
	eq($out['chat_code'], '');
	eq($GLOBALS['errors'][0], array('jarchat-chat', 'error'));
	$GLOBALS['errors'] = array();
	$out = jarchat_sanitize(array('chat_code' => '<script src="https://gmm-chatwidget.vercel.app/chat.js"></script>'));
	eq($GLOBALS['errors'][0], array('jarchat-source', 'warning'));
	eq($out['chat_tag']['src'], 'https://gmm-chatwidget.vercel.app/chat.js');
});

test('custom CSS after the tag is kept, and cannot end its style block early', function () {
	$tag = jarchat_parse_tag("<script src=\"https://gmm-chatwidget.vercel.app/embed.js\" data-source=\"x\"></script>\n<style>\n.cb-btn { color: red }\n</style>");
	eq($tag['css'], '.cb-btn { color: red }');
	$html = jarchat_render_tag(array('src' => $tag['src'], 'data' => array(), 'css' => 'a{}</style><script>alert(1)</script>'), array());
	eq(substr_count(strtolower($html), '</style'), 1, 'only the real closing tag');
	eq(substr_count(strtolower($html), '<script'), 1, 'no second script');
	eq(jarchat_parse_tag($html)['css'], 'a{}\3c /style>\3c script>alert(1)\3c /script>');
	eq(jarchat_parse_tag('<script src="https://gmm-chatwidget.vercel.app/chat.js"></script>')['css'] ?? null, null);
});

test('a copy of the setup page on this computer may use http; other sites may not', function () {
	eq(jarchat_parse_tag('<script src="http://127.0.0.1:8793/embed.js"></script>')['src'], 'http://127.0.0.1:8793/embed.js');
	eq(jarchat_parse_tag('<script src="http://localhost/chat.js"></script>')['src'], 'http://localhost/chat.js');
	eq(jarchat_parse_tag('<script src="http://127.0.0.1.evil.example/chat.js"></script>'), null);
});

test('saving keeps backslashes: WordPress has already unslashed the form', function () {
	$out = jarchat_sanitize(array('chat_code' => '<script src="https://gmm-chatwidget.vercel.app/chat.js" data-source="s" data-greeting="a\\b"></script>'));
	eq($out['chat_tag']['data']['greeting'], 'a\\b');
});

function ajax_save($post, $nonce = 'nonce-jarchat_save') {
	$_POST = $post;
	$_REQUEST = $post + array('_ajax_nonce' => $nonce);
	try {
		jarchat_ajax_save();
	} catch (WPStubJson $r) {
		return $r;
	}
	throw new Exception('no JSON answer');
}

test('Save to WordPress: stores the code, keeps the saved form code when none is sent', function () use ($SETUP_CODE) {
	$GLOBALS['admin'] = true;
	$GLOBALS['options']['jarchat_settings'] = jarchat_sanitize(array(
		'chat_code' => '',
		'form_code' => '<script src="https://gmm-chatwidget.vercel.app/embed.js" data-fields="old"></script>',
	));
	// Sent slashed, as PHP and WordPress pass $_POST to the handler.
	$r = ajax_save(array('chat_code' => addslashes($SETUP_CODE)));
	eq($r->body['success'], true);
	eq(strpos($r->body['data']['message'], 'Saved.') === 0, true);
	eq($r->body['data']['warning'], false);
	$s = jarchat_settings();
	eq($s['chat_tag']['data']['greeting'], "Hey {first_name}, I'm here & happy to help.");
	eq($s['form_tag']['data']['fields'], 'old', 'form code kept');
	eq($r->body['data']['chat_code'], $s['chat_code']);
	$r = ajax_save(array('chat_code' => addslashes($SETUP_CODE), 'form_code' => '<script src="https://gmm-chatwidget.vercel.app/embed.js" data-fields="new"></script>'));
	eq(jarchat_settings()['form_tag']['data']['fields'], 'new');
	eq(strpos($r->body['data']['message'], '[jarchat_form]') !== false, true);
	$GLOBALS['admin'] = false;
});

test('Save to WordPress: refuses bad code, other users and a missing nonce, and warns without a source', function () use ($SETUP_CODE) {
	$GLOBALS['admin'] = true;
	$GLOBALS['options']['jarchat_settings'] = jarchat_sanitize(array('chat_code' => $SETUP_CODE));
	$before = $GLOBALS['options']['jarchat_settings'];
	$r = ajax_save(array('chat_code' => '<script src="https://evil.example/x.js"></script>'));
	eq($r->body['success'], false);
	eq(strpos($r->body['data']['message'], 'isn’t a JARchat script tag') !== false, true);
	eq($GLOBALS['options']['jarchat_settings'], $before, 'nothing saved');
	eq(ajax_save(array('chat_code' => $SETUP_CODE), 'wrong')->status, 403);
	$GLOBALS['admin'] = false;
	$r = ajax_save(array('chat_code' => $SETUP_CODE));
	eq(array($r->status, $r->body['success']), array(403, false));
	eq($GLOBALS['options']['jarchat_settings'], $before, 'still nothing saved');
	$GLOBALS['admin'] = true;
	$r = ajax_save(array('chat_code' => '<script src="https://gmm-chatwidget.vercel.app/chat.js"></script>'));
	eq(array($r->body['success'], $r->body['data']['warning']), array(true, true));
	eq(strpos($r->body['data']['message'], 'no source ID') !== false, true);
	$GLOBALS['admin'] = false;
});

test('the settings page frames the setup page and only trusts messages from it', function () {
	$GLOBALS['admin'] = true;
	$GLOBALS['options']['jarchat_settings'] = array();
	ob_start();
	jarchat_settings_page();
	$html = ob_get_clean();
	$GLOBALS['admin'] = false;
	eq(strpos($html, '<iframe id="jarchat-wizard"') !== false, true);
	eq(strpos($html, '"setup":"' . JARCHAT_SETUP_URL . '"') !== false, true);
	eq(strpos($html, '"nonce":"nonce-jarchat_save"') !== false, true);
	eq(strpos($html, 'e.origin !== setupOrigin || e.source !== frame.contentWindow') !== false, true);
	eq(strpos($html, '<details open id="jarchat-manual">') !== false, true, 'nothing saved: the paste boxes are open');
});

test('the download zip holds the current plugin files', function () {
	$dir = __DIR__ . '/../wordpress/jarchat';
	$zip = new ZipArchive();
	eq($zip->open(__DIR__ . '/../wordpress/jarchat.zip'), true, 'wordpress/jarchat.zip opens');
	$files = array_values(array_filter(scandir($dir), function ($f) { return $f[0] !== '.'; }));
	foreach ($files as $f) {
		eq($zip->getFromName('jarchat/' . $f) === file_get_contents("$dir/$f"), true, "jarchat/$f is out of date; run: cd wordpress && zip -X -r jarchat.zip jarchat");
	}
	eq($zip->numFiles >= count($files), true);
});

test('the plugin page shows the current version and every release', function () {
	$plugin = file_get_contents(__DIR__ . '/../wordpress/jarchat/jarchat.php');
	$readme = file_get_contents(__DIR__ . '/../wordpress/jarchat/readme.txt');
	$page = file_get_contents(__DIR__ . '/../site/wordpress.html');
	preg_match('/^ \* Version:\s*(\S+)/m', $plugin, $v);
	eq(strpos($readme, 'Stable tag: ' . $v[1]) !== false, true, 'readme.txt Stable tag');
	eq(JARCHAT_VERSION, $v[1], 'JARCHAT_VERSION');
	eq(strpos($page, '<strong id="version">' . $v[1] . '</strong>') !== false, true, 'site/wordpress.html version');
	preg_match_all('/^= (\S+) =$/m', $readme, $releases);
	foreach ($releases[1] as $r) {
		eq(strpos($page, 'data-version="' . $r . '"') !== false, true, "release notes for $r on site/wordpress.html");
	}
});

echo "\n$passed/" . ($passed + $failed) . " passed\n";
exit($failed ? 1 : 0);
