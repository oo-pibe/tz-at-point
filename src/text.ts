/**
 * Escape everything outside printable ASCII, so input cannot forge log lines or send terminal control codes.
 * `keepNewlines` is for text tz-at-point wrote itself, such as usage and Node's own multi-line errors.
 */
export const printable = (text: string, keepNewlines = false) =>
  text.replace(keepNewlines ? /[^\n\x20-\x7e]/g : /[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** A short, printable rendering of an untrusted value for an error message. */
export function quote(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = Object.prototype.toString.call(value);
  }
  return printable(text.length > 40 ? `${text.slice(0, 40)}...` : text);
}
