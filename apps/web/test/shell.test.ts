import { describe, expect, it } from 'vitest';

import { injectShellOg } from '../src/render/shell';

const BASE_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Chatsoon</title>
<meta name="description" content="Meet people. Follow up." />
<link rel="icon" href="/favicon.ico" />
</head>
<body><div id="root"></div></body>
</html>
`;

describe('injectShellOg', () => {
  it('inserts the marker block right after the charset tag', () => {
    const html = injectShellOg(BASE_SHELL);
    const charsetIndex = html.indexOf('<meta charset="utf-8" />');
    const markerIndex = html.indexOf('<!--og-->');
    expect(markerIndex).toBeGreaterThan(charsetIndex);
    expect(markerIndex).toBe(charsetIndex + '<meta charset="utf-8" />'.length);
  });

  it('removes the original <title> and <meta name="description">', () => {
    const html = injectShellOg(BASE_SHELL);
    // Only the one inside the marker block should remain.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    expect(html).not.toContain('<title>Chatsoon</title>');
  });

  it('has exactly one og:image and no og:url or canonical', () => {
    const html = injectShellOg(BASE_SHELL);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).not.toContain('og:url');
    expect(html).not.toContain('rel="canonical"');
  });

  it('ends the marker block before byte 2048', () => {
    const html = injectShellOg(BASE_SHELL);
    const endIndex = html.indexOf('<!--/og-->');
    expect(endIndex).toBeGreaterThan(-1);
    expect(Buffer.byteLength(html.slice(0, endIndex + '<!--/og-->'.length), 'utf8')).toBeLessThan(2048);
  });

  it('throws when the charset marker is missing', () => {
    expect(() => injectShellOg(BASE_SHELL.replace('<meta charset="utf-8" />', ''))).toThrow();
  });

  it('throws when there is more than one charset tag', () => {
    const doubled = BASE_SHELL.replace(
      '<meta charset="utf-8" />',
      '<meta charset="utf-8" /><meta charset="utf-8" />',
    );
    expect(() => injectShellOg(doubled)).toThrow();
  });
});
