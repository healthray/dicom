import { normalizeAllowedOrigins, redactUrl, resolveLocalFileUrl } from './resolveFileUrl';

const PAGE_ORIGIN = 'https://viewer.example.com';
const TRUSTED = 'https://media.example.com';

const resolve = (url: string | null | undefined, allowedOrigins: unknown = [TRUSTED]) =>
  resolveLocalFileUrl(url, { allowedOrigins, pageOrigin: PAGE_ORIGIN });

describe('resolveFileUrl', () => {
  // The allowlist parser logs rejected entries; silence it so the suite output
  // stays readable, and so a test asserting a rejection does not look like a
  // failure.
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  describe('resolveLocalFileUrl', () => {
    it('accepts an allowlisted https origin', () => {
      expect(resolve(`${TRUSTED}/studies/a.dcm`).href).toBe(`${TRUSTED}/studies/a.dcm`);
    });

    it('preserves the query string, which carries the signature', () => {
      const signed = `${TRUSTED}/a.dcm?X-Amz-Signature=abc123&X-Amz-Expires=300`;
      expect(resolve(signed).search).toBe('?X-Amz-Signature=abc123&X-Amz-Expires=300');
    });

    it('always allows the page origin without configuration', () => {
      expect(resolve(`${PAGE_ORIGIN}/local/a.dcm`, []).origin).toBe(PAGE_ORIGIN);
    });

    it('resolves a relative url against the page origin', () => {
      expect(resolve('/local/a.dcm', []).href).toBe(`${PAGE_ORIGIN}/local/a.dcm`);
    });

    it.each([null, undefined, ''])('rejects a missing url (%p)', value => {
      expect(() => resolve(value)).toThrow(/Missing required/);
    });

    it('rejects an origin that is not allowlisted', () => {
      expect(() => resolve('https://attacker.example/x.dcm')).toThrow(
        /Blocked "url" origin "https:\/\/attacker.example"/
      );
    });

    it('names the config key to set when it blocks an origin', () => {
      expect(() => resolve('https://attacker.example/x.dcm')).toThrow(/allowedLocalFileOrigins/);
    });

    // The dev server serves config/dev.js while a production build serves
    // config/default.js, so "which file" is the part people get wrong.
    it('names the config file actually in effect', () => {
      expect(() =>
        resolveLocalFileUrl('https://attacker.example/x.dcm', {
          allowedOrigins: [TRUSTED],
          pageOrigin: PAGE_ORIGIN,
          configName: 'config/dev.js',
        })
      ).toThrow(/config\/dev\.js/);
    });

    it('reports what the config does currently allow', () => {
      expect(() => resolve('https://attacker.example/x.dcm')).toThrow(
        new RegExp(`currently allows: ${TRUSTED}`)
      );
    });

    it('says so explicitly when nothing cross-origin is allowed', () => {
      expect(() => resolve('https://attacker.example/x.dcm', [])).toThrow(
        /currently allows no cross-origin hosts/
      );
    });

    it.each([
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:application/dicom;base64,AAAA',
      'blob:https://viewer.example.com/abc',
    ])('rejects the non-http(s) protocol in %s', value => {
      expect(() => resolve(value)).toThrow(/only http: and https: are allowed|not a valid URL/);
    });

    it('rejects embedded credentials', () => {
      expect(() => resolve('https://user:pass@media.example.com/a.dcm')).toThrow(
        /embedded credentials/
      );
    });

    it('rejects a fragment', () => {
      expect(() => resolve(`${TRUSTED}/a.dcm#frag`)).toThrow(/fragment/);
    });

    it('does not treat a substring of an allowed origin as allowed', () => {
      expect(() => resolve('https://media.example.com.attacker.test/a.dcm')).toThrow(
        /Blocked "url" origin/
      );
    });

    it('distinguishes port and scheme when matching', () => {
      expect(() => resolve('https://media.example.com:8443/a.dcm')).toThrow(/Blocked "url" origin/);
      expect(() => resolve('http://media.example.com/a.dcm')).toThrow(/Blocked "url" origin/);
    });
  });

  describe('normalizeAllowedOrigins', () => {
    it('keeps bare origins', () => {
      expect(normalizeAllowedOrigins([TRUSTED, 'http://localhost:5000'])).toEqual([
        TRUSTED,
        'http://localhost:5000',
      ]);
    });

    it('normalizes a trailing slash to a bare origin', () => {
      expect(normalizeAllowedOrigins([`${TRUSTED}/`])).toEqual([TRUSTED]);
    });

    it.each([
      [`${TRUSTED}/some/path`, 'a path'],
      [`${TRUSTED}?a=1`, 'a query'],
      [`${TRUSTED}#frag`, 'a fragment'],
      ['https://user:pass@media.example.com', 'userinfo'],
      ['ftp://media.example.com', 'a non-http protocol'],
      ['not a url', 'an unparseable entry'],
    ])('discards %s (%s)', entry => {
      expect(normalizeAllowedOrigins([entry])).toEqual([]);
    });

    it.each([undefined, null, 'a string', 42, {}])('returns [] for non-array %p', value => {
      expect(normalizeAllowedOrigins(value)).toEqual([]);
    });

    it('drops non-string members but keeps valid ones', () => {
      expect(normalizeAllowedOrigins([TRUSTED, 42, null, '  '])).toEqual([TRUSTED]);
    });
  });

  describe('redactUrl', () => {
    it('strips the query string that carries the signature', () => {
      expect(redactUrl(new URL(`${TRUSTED}/a.dcm?X-Amz-Signature=secret`))).toBe(
        `${TRUSTED}/a.dcm?<redacted>`
      );
    });

    it('leaves a url with no query intact', () => {
      expect(redactUrl(new URL(`${TRUSTED}/a.dcm`))).toBe(`${TRUSTED}/a.dcm`);
    });

    it('accepts a string', () => {
      expect(redactUrl(`${TRUSTED}/a.dcm?sig=secret`)).toBe(`${TRUSTED}/a.dcm?<redacted>`);
    });

    it.each([null, undefined, ''])('reports %p as (no url)', value => {
      expect(redactUrl(value)).toBe('(no url)');
    });

    it('does not echo back an unparseable value', () => {
      expect(redactUrl('https://user:pass@ho st/?secret=1')).toBe('(unparseable url)');
    });
  });
});
