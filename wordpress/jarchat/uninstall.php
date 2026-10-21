<?php
// Removes the saved code when the plugin is deleted.
if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}
delete_option('jarchat_settings');
