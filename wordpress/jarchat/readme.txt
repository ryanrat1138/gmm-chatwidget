=== JARchat ===
Contributors: greatmountainmarketing
Tags: chat, ai chat, thank you page, closebot, highlevel
Requires at least: 5.7
Tested up to: 6.8
Requires PHP: 7.2
Stable tag: 1.2.0

Join. Answer. Relay. Adds the JARchat AI chat to form thank-you pages with a shortcode.

== Description ==

JARchat opens a CloseBot AI chat on your thank-you page that already knows what the visitor just submitted.

The JARchat setup runs right inside WordPress under Settings › JARchat. Its last step has a "Save to WordPress" button, so each page then only needs a shortcode. It also gets around WordPress removing script tags for users without the "unfiltered HTML" permission, and asks script optimizers to leave the tag alone.

The chat itself still loads from JARchat's server, so improvements reach your site without updating the plugin.

== Installation ==

1. In WordPress, go to Plugins › Add New Plugin › Upload Plugin, choose jarchat-wordpress.zip, click Install Now and then Activate Plugin.
2. Go to Settings › JARchat and work through the setup there.
3. At the last step, click "Save to WordPress".
4. Add a Shortcode block with `[jarchat]` to the thank-you page where the chat (or its card) should appear.
5. If the form is on this site, also add `[jarchat_form]` to the form page.

You can also paste code from the setup page yourself under "Saved code" on the same screen.

== Shortcodes ==

* `[jarchat]` adds the chat with your saved settings.
* `[jarchat_form]` adds the chat-free tag that remembers what the visitor submits on the form page.

Any setting from the code can be changed for one page by naming it without `data-`:

* `[jarchat layout="bubble"]`
* `[jarchat cta="off"]`
* `[jarchat greeting="Hi {first_name}!"]`

== Changelog ==

= 1.2.0 =
* The setup grows to its full height on Settings › JARchat, so only the page scrolls.
* Moving to the next step scrolls to its top.

= 1.1.0 =
* The setup runs inside Settings › JARchat, with a "Save to WordPress" button at its last step.
* Keeps the custom CSS from the setup page's look step.
* Code with a backslash in it is saved as written.

= 1.0.0 =
* First release: settings page and the `[jarchat]` and `[jarchat_form]` shortcodes.
