import {
  Grammar,
  IncomingRequestMessage,
  IncomingResponseMessage,
  Logger
} from "./core";

/**
 * Extract and parse every header of a SIP message.
 * @namespace
 */
export namespace Parser {

  export function getHeader(data: any, headerStart: number): number {
    // 'start' position of the header.
    let start: number = headerStart;
    // 'end' position of the header.
    let end: number = 0;
    // 'partial end' position of the header.
    let partialEnd: number = 0;

    // End of message.
    if (data.substring(start, start + 2).match(/(^\r\n)/)) {
      return -2;
    }

    while (end === 0) {
      // Partial End of Header.
      partialEnd = data.indexOf("\r\n", start);

      // 'indexOf' returns -1 if the value to be found never occurs.
      if (partialEnd === -1) {
        return partialEnd;
      }

      if (!data.substring(partialEnd + 2, partialEnd + 4).match(/(^\r\n)/) &&
          data.charAt(partialEnd + 2).match(/(^\s+)/)) {
        // Not the end of the message. Continue from the next position.
        start = partialEnd + 2;
      } else {
        end = partialEnd;
      }
    }

    return end;
  }

  export function parseHeader(
    message: IncomingRequestMessage | IncomingResponseMessage,
    data: any,
    headerStart: number,
    headerEnd: number
  ): boolean | {error: string} {
    const hcolonIndex: number = data.indexOf(":", headerStart);
    const headerName: string = data.substring(headerStart, hcolonIndex).trim();
    const headerValue: string = data.substring(hcolonIndex + 1, headerEnd).trim();

    let parsed: any;
    // If header-field is well-known, parse it.
    switch (headerName.toLowerCase()) {
      case "via":
      case "v":
        message.addHeader("via", headerValue);
        if (message.getHeaders("via").length === 1) {
          parsed = message.parseHeader("Via");
          if (parsed) {
            message.via = parsed;
            message.viaBranch = parsed.branch;
          }
        } else {
          parsed = 0;
        }
        break;
      case "from":
      case "f":
        message.setHeader("from", headerValue);
        parsed = message.parseHeader("from");
        if (parsed) {
          message.from = parsed;
          message.fromTag = parsed.getParam("tag");
        }
        break;
      case "to":
      case "t":
        message.setHeader("to", headerValue);
        parsed = message.parseHeader("to");
        if (parsed) {
          message.to = parsed;
          message.toTag = parsed.getParam("tag");
        }
        break;
      case "record-route":
        parsed = Grammar.parse(headerValue, "Record_Route");

        if (parsed === -1) {
          parsed = undefined;
          break;
        }

        for (const header in parsed) {
          if (parsed[header]) {
            message.addHeader("record-route", headerValue.substring(parsed[header].position, parsed[header].offset));
            message.headers["Record-Route"][message.getHeaders("record-route").length - 1].parsed =
              parsed[header].parsed;
          }
        }
        break;
      case "call-id":
      case "i":
        message.setHeader("call-id", headerValue);
        parsed = message.parseHeader("call-id");
        if (parsed) {
          message.callId = headerValue;
        }
        break;
      case "contact":
      case "m":
        parsed = Grammar.parse(headerValue, "Contact");

        if (parsed === -1) {
          parsed = undefined;
          break;
        }
        if (!(parsed instanceof Array)) {
          parsed = undefined;
          break;
        }

        parsed.forEach((header) => {
          message.addHeader("contact", headerValue.substring(header.position, header.offset));
          message.headers.Contact[message.getHeaders("contact").length - 1].parsed = header.parsed;
        });
        break;
      case "content-length":
      case "l":
        message.setHeader("content-length", headerValue);
        parsed = message.parseHeader("content-length");
        break;
      case "content-type":
      case "c":
        message.setHeader("content-type", headerValue);
        parsed = message.parseHeader("content-type");
        break;
      case "cseq":
        message.setHeader("cseq", headerValue);
        parsed = message.parseHeader("cseq");
        if (parsed) {
          message.cseq = parsed.value;
        }
        if (message instanceof IncomingResponseMessage) {
          message.method = parsed.method;
        }
        break;
      case "max-forwards":
        message.setHeader("max-forwards", headerValue);
        parsed = message.parseHeader("max-forwards");
        break;
      case "www-authenticate":
        message.setHeader("www-authenticate", headerValue);
        parsed = message.parseHeader("www-authenticate");
        break;
      case "proxy-authenticate":
        message.setHeader("proxy-authenticate", headerValue);
        parsed = message.parseHeader("proxy-authenticate");
        break;
      case "refer-to":
      case "r":
        message.setHeader("refer-to", headerValue);
        parsed = message.parseHeader("refer-to");
        if (parsed) {
          message.referTo = parsed;
        }
        break;
      default:
        // Do not parse this header.
        message.setHeader(headerName, headerValue);
        parsed = 0;
    }

    if (parsed === undefined) {
      return {
        error: "error parsing header '" + headerName + "'"
      };
    } else {
      return true;
    }
  }

  /** Parse SIP Message
   * @function
   * @param {String} message SIP message.
   * @param {Object} logger object.
   * @returns {SIP.IncomingRequest|SIP.IncomingResponse|undefined}
   */
  export function parseMessage(
    data: string,
    logger: Logger
  ): IncomingRequestMessage | IncomingResponseMessage | undefined {
    let headerStart: number = 0;
    let headerEnd: number = data.indexOf("\r\n");

    if (headerEnd === -1) {
      logger.warn("no CRLF found, not a SIP message, discarded");
      return;
    }

    // Parse first line. Check if it is a Request or a Reply.
    const firstLine: string = data.substring(0, headerEnd);
    const parsed: any = Grammar.parse(firstLine, "Request_Response");
    let message: IncomingRequestMessage | IncomingResponseMessage;

    if (parsed === -1) {
      logger.warn('error parsing first line of SIP message: "' + firstLine + '"');
      return;
    } else if (!parsed.status_code) {
      message = new IncomingRequestMessage();
      message.method = parsed.method;
      message.ruri = parsed.uri;
    } else {
      message = new IncomingResponseMessage();
      message.statusCode = parsed.status_code;
      message.reasonPhrase = parsed.reason_phrase;
    }

    message.data = data;
    headerStart = headerEnd + 2;

    /* Loop over every line in data. Detect the end of each header and parse
    * it or simply add to the headers collection.
    */
    let bodyStart: number;
    while (true) {
      headerEnd = getHeader(data, headerStart);

      // The SIP message has normally finished.
      if (headerEnd === -2) {
        bodyStart = headerStart + 2;
        break;
      } else if (headerEnd === -1) {
        // data.indexOf returned -1 due to a malformed message.
        logger.error("malformed message");
        return;
      }

      const parsedHeader: any = parseHeader(message, data, headerStart, headerEnd);

      if (parsedHeader !== true) {
        logger.error(parsed.error);
        return;
      }

      headerStart = headerEnd + 2;
    }

    /* RFC3261 18.3.
    * If there are additional bytes in the transport packet
    * beyond the end of the body, they MUST be discarded.
    */
    if (message.hasHeader("content-length")) {
      message.body = data.substr(bodyStart, Number(message.getHeader("content-length")));
    } else {
      message.body = data.substring(bodyStart);
    }

    return message;
  }
}
