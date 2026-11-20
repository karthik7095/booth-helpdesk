package expo.modules.whatsappshare

import expo.modules.kotlin.exception.CodedException

class WhatsAppMissingException :
  CodedException("WhatsApp is not installed on this phone.")
