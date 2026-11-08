import { OmniDBTransport } from './transport';
import { DesktopTransport } from './desktop';
import { WebTransport } from './web';

let instance: OmniDBTransport | null = null;

export function getTransport(): OmniDBTransport {
  if (!instance) {
    if (typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
      instance = new DesktopTransport();
    } else {
      instance = new WebTransport();
    }
  }
  return instance;
}
