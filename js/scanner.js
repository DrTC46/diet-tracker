// Camera barcode scanning. ZXing is used everywhere because iPhone Safari has no BarcodeDetector.
// It loads on first use to keep app start-up fast.

let libraryPromise;

function loadLibrary() {
  libraryPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/zxing.min.js';
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => {
      libraryPromise = undefined;
      reject(new Error('Could not load the barcode scanner.'));
    };
    document.head.append(script);
  });
  return libraryPromise;
}

const isValidBarcode = (code) => /^\d{8,14}$/.test(code);

// Full-screen scanner. Resolves with a barcode, or null when cancelled.
// A typed barcode is always available, for when the camera is refused or can't read the label.
export function scanBarcode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'scanner';
    overlay.innerHTML = `
      <video playsinline muted></video>
      <div class="scanner-frame"></div>
      <div class="scanner-panel">
        <p class="scanner-status" role="status">Starting camera...</p>
        <form class="row">
          <input class="grow" inputmode="numeric" autocomplete="off" placeholder="Or type the barcode" aria-label="Barcode number">
          <button class="btn" type="submit">Look up</button>
        </form>
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
      </div>`;
    document.body.append(overlay);

    const status = overlay.querySelector('.scanner-status');
    let reader = null;
    let finished = false;

    const finish = (code) => {
      if (finished) return;
      finished = true;
      reader?.reset();
      overlay.remove();
      resolve(code);
    };

    overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = overlay.querySelector('input').value.replace(/\s/g, '');
      if (isValidBarcode(code)) finish(code);
      else status.textContent = 'A barcode has 8 to 14 digits.';
    });

    (async () => {
      try {
        const ZXing = await loadLibrary();
        if (finished) return;
        const hints = new Map([
          [ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]],
          [ZXing.DecodeHintType.TRY_HARDER, true],
        ]);
        reader = new ZXing.BrowserMultiFormatReader(hints, 200);
        await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
          overlay.querySelector('video'),
          (scanned) => {
            if (scanned) finish(scanned.getText());
          }
        );
        if (finished) reader.reset();
        else status.textContent = 'Point the camera at the barcode.';
      } catch (error) {
        if (finished) return;
        status.textContent = error?.name === 'NotAllowedError'
          ? 'Camera access was refused. You can type the barcode instead.'
          : 'The camera is not available. You can type the barcode instead.';
      }
    })();
  });
}
