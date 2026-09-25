// The `qrcode` package (a devDependency used only by build.ts, to draw the home page's decorative
// QR code) ships no types and has no official @types package. This covers only the slice of its API
// this repo calls — extend it if build.ts starts using more of it.
declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal';
    margin?: number;
    width?: number;
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
  }

  const QRCode: {
    /** Promise-returning form (no callback argument) of node-qrcode's `toString`. */
    toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  };

  export default QRCode;
}
