package expo.modules.whatsappshare

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.net.toUri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Sends one image with the slip text as its caption.
 *
 * `expo-sharing` puts the image on the intent but no text, and
 * `expo-intent-launcher` passes every extra as a string, so EXTRA_STREAM never
 * arrives as the Uri that WhatsApp expects. Hence these few lines of our own.
 */
private const val WHATSAPP = "com.whatsapp"
private const val WHATSAPP_BUSINESS = "com.whatsapp.w4b"

class WhatsAppShareModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WhatsAppShare")

    /** Which WhatsApp is installed, if either — the app asks before offering the image. */
    Function("installedPackage") {
      listOf(WHATSAPP, WHATSAPP_BUSINESS).firstOrNull { installed(it) }
    }

    /**
     * `contentUri` must be a content:// URI this app may grant read access to —
     * `File.contentUri` from expo-file-system gives one. `phone` is the voter's
     * number in full international form without "+", e.g. "919876543210"; when
     * WhatsApp recognises it the chat opens straight away, and otherwise it
     * falls back to its own contact picker.
     */
    AsyncFunction("shareImageWithText") { contentUri: String, text: String, phone: String? ->
      val target = listOf(WHATSAPP, WHATSAPP_BUSINESS).firstOrNull { installed(it) }
        ?: throw WhatsAppMissingException()

      val uri = contentUri.toUri()
      // The exact type ("image/jpeg"), not "image/*": with a wildcard some
      // WhatsApp builds open the chat with the caption but drop the picture.
      val type = context.contentResolver.getType(uri) ?: "image/jpeg"

      val intent = Intent(Intent.ACTION_SEND).apply {
        setPackage(target)
        setType(type)
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, text)
        phone?.let { putExtra("jid", "$it@s.whatsapp.net") }
        // FLAG_GRANT_READ_URI_PERMISSION covers URIs in ClipData, not extras.
        // Android usually copies EXTRA_STREAM across on its own; set it here
        // so the grant never depends on that.
        clipData = ClipData.newRawUri("", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      // Belt and braces: WhatsApp reads the file after we have handed off.
      context.grantUriPermission(target, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)

      context.startActivity(intent)

      target
    }

    /**
     * WhatsApp ignores the "jid" above unless the number is in the phone's
     * contacts, and only a wa.me link opens an unsaved number's chat — with
     * text, never a picture. So: the image goes on the clipboard, the chat
     * opens with the text typed in, and the agent pastes the image.
     */
    AsyncFunction("openChatWithImageCopied") { contentUri: String, text: String, phone: String ->
      val target = listOf(WHATSAPP, WHATSAPP_BUSINESS).firstOrNull { installed(it) }
        ?: throw WhatsAppMissingException()

      val uri = contentUri.toUri()
      // Lets WhatsApp read the file when the agent pastes, long after we hand off.
      context.grantUriPermission(target, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)

      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, "Voter slip", uri))

      val link = "https://wa.me/$phone?text=${Uri.encode(text)}".toUri()
      val intent = Intent(Intent.ACTION_VIEW, link).apply {
        setPackage(target)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      Handler(Looper.getMainLooper()).post {
        Toast.makeText(
          context,
          "Image copied. Long-press the message box and tap Paste.",
          Toast.LENGTH_LONG,
        ).show()
      }

      context.startActivity(intent)

      target
    }
  }

  private fun installed(packageName: String): Boolean =
    try {
      context.packageManager.getPackageInfo(packageName, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
}
