// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { LIMITS } from '@agentdocstore/core';
import { MAX_CONTENT_BYTES } from './constants.js';
import { languageForFileName, readTextFile, titleForFileName } from './file-load.js';

describe('languageForFileName', () => {
  it.each([
    ['notes.md', 'markdown'],
    ['README.markdown', 'markdown'],
    ['flow.mmd', 'mermaid'],
    ['app.ts', 'typescript'],
    ['index.js', 'javascript'],
    ['main.py', 'python'],
    ['Main.java', 'java'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['DATA.JSON', 'json'],
    ['config.yml', 'yaml'],
    ['config.yaml', 'yaml'],
    ['feed.xml', 'xml'],
    ['page.html', 'html'],
    ['site.css', 'css'],
    ['query.sql', 'sql'],
    ['build.sh', 'bash'],
    ['Dockerfile', 'dockerfile'],
    ['notes.txt', 'plaintext'],
  ])('picks the language for %s', (name, language) => {
    expect(languageForFileName(name)).toBe(language);
  });

  it('leaves the language alone for a name it does not know', () => {
    expect(languageForFileName('archive.zip')).toBeNull();
    expect(languageForFileName('LICENSE')).toBeNull();
  });
});

describe('titleForFileName', () => {
  it('uses the name without its extension', () => {
    expect(titleForFileName('Release notes.md')).toBe('Release notes');
    expect(titleForFileName('backup.tar.gz')).toBe('backup.tar');
  });

  it('keeps a name that has no extension, or is only one', () => {
    expect(titleForFileName('Dockerfile')).toBe('Dockerfile');
    expect(titleForFileName('.env')).toBe('.env');
  });
});

describe('readTextFile', () => {
  it('uses the same content limit as the server', () => {
    expect(MAX_CONTENT_BYTES).toBe(LIMITS.MAX_CONTENT_BYTES);
  });

  it('reads a text file', async () => {
    await expect(readTextFile(new File(['# Notes\n'], 'notes.md'))).resolves.toBe('# Notes\n');
  });

  it('refuses a file over the content limit without reading it, saying by how much', async () => {
    const big = new File(['x'], 'big.log');
    Object.defineProperty(big, 'size', { value: MAX_CONTENT_BYTES + 1 });
    await expect(readTextFile(big)).rejects.toThrow(
      `big.log is ${MAX_CONTENT_BYTES + 1} bytes; the limit is ${MAX_CONTENT_BYTES} bytes.`,
    );
  });

  it('refuses a file that is not text', async () => {
    const binary = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])], 'logo.png');
    await expect(readTextFile(binary)).rejects.toThrow('logo.png does not look like a text file.');
  });
});
