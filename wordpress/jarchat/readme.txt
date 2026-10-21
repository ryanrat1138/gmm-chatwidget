=== JARchat ===
Contributors: greatmountainmarketing
Tags: chat, ai chat, thank you page, closebot, highlevel
Requires at least: 5.7
Tested up to: 6.8
Requires PHP: 7.2
Stable tag: 1.0.0

Join. Answer. Relay. Adds the JARchat AI chat to form thank-you pages with a shortcode.

== Description ==

JARchat opens a CloseBot AI chat on your thank-you page that already knows what the visitor just submitted.

This plugin saves the code from the JARchat setup page once, so each page only needs a shortcode. It also gets around WordPress removing script tags for users without the "unfiltered HTML" permission, and asks script optimizers to leave the tag alone.

The chat itself still loads from JARchat's server, so improvements reach your site without updating the plugin.

== Installation ==

1. In WordPress, go to Plugins › Add New › Upload Plugin, choose jarchat.zip and activate it.
2. Open the JARchat setup page, work through steps 1 to 3, and copy the "Thank-you page code" from step 4.
3. Paste it under Settings › JARchat and save.
4. Add `[jarchat]` to the thank-you page where the chat (or its call-to-action card) should appear.
5. If the form is on this site, also paste the "Form page code" and add `[jarchat_form]` to the form page.

== Shortcodes ==

* `[jarchat]` adds the chat with your saved settings.
* `[jarchat_form]` adds the chat-free tag that remembers what the visitor submits on the form page.

Any setting from the code can be changed for one page by naming it without `data-`:

* `[jarchat layout="bubble"]`
* `[jarchat cta="off"]`
* `[jarchat greeting="Hi {first_name}!"]`

== Changelog ==

= 1.0.0 =
* First release: settings page and the `[jarchat]` and `[jarchat_form]` shortcodes.
