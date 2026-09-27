/**
 * Load a text file into the create or edit form, from a Load File button or by
 * dropping the file on the text box. The file is read in the browser; nothing
 * is uploaded until the form is saved.
 */
import { MAX_CONTENT_BYTES } from './constants.js';
import { showToast } from './toast.js';

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mmd', 'mermaid'],
  ['mermaid', 'mermaid'],
  ['txt', 'plaintext'],
  ['text', 'plaintext'],
  ['log', 'plaintext'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'javascript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'typescript'],
  ['py', 'python'],
  ['java', 'java'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['json', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['xml', 'xml'],
  ['html', 'html'],
  ['htm', 'html'],
  ['css', 'css'],
  ['sql', 'sql'],
  ['sh', 'bash'],
  ['bash', 'bash'],
  ['zsh', 'bash'],
]);

/** The document language a file name implies, or null when it does not say. */
export function languageForFileName(name: string): string | null {
  if (/^dockerfile$/i.test(name) || /\.dockerfile$/i.test(name)) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** A title for a file: its name without the last extension. */
export function titleForFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** A file's text. Refuses one over the content limit (unread) or one that is not text. */
export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_CONTENT_BYTES) {
    throw new Error(`${file.name} is ${file.size} bytes; the limit is ${MAX_CONTENT_BYTES} bytes.`);
  }
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file); // UTF-8
  });
  // Text files do not contain NUL; images, archives and other binaries do.
  if (text.includes('\u0000')) throw new Error(`${file.name} does not look like a text file.`);
  return text;
}

/**
 * A Load File button and the hidden file input it opens, plus drop-to-load on
 * the text box. The file replaces the text in the box, asking first when there
 * is some; the title is filled from the file name only when it is empty, and
 * the language only when the name says which. `onLoaded` runs after a load.
 */
export function fileLoader(fields: {
  contentArea: HTMLTextAreaElement;
  titleInput: HTMLInputElement;
  languageSelect: HTMLSelectElement;
  onLoaded?: () => void;
}): { button: HTMLButtonElement; input: HTMLInputElement } {
  const { contentArea, titleInput, languageSelect, onLoaded } = fields;

  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm';
  button.textContent = 'Load File';
  button.addEventListener('click', () => input.click());

  const load = async (file: File): Promise<void> => {
    let text: string;
    try {
      text = await readTextFile(file);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read the file', 'error');
      return;
    }
    if (
      contentArea.value.trim() !== '' &&
      !window.confirm(`Replace the text in the box with ${file.name}?`)
    ) {
      return;
    }
    contentArea.value = text;
    if (titleInput.value.trim() === '') titleInput.value = titleForFileName(file.name);
    const language = languageForFileName(file.name);
    if (language !== null && [...languageSelect.options].some((o) => o.value === language)) {
      languageSelect.value = language;
    }
    onLoaded?.();
    showToast(`Loaded ${file.name}`, 'success');
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again still loads it
    if (file) void load(file);
  });
  contentArea.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  contentArea.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    void load(file);
  });

  return { button, input };
}
