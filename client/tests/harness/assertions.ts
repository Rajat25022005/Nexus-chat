import assert from "node:assert/strict";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CROCKFORD_ALPHABET = new Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ-");

/**
 * Asserts that a value is a valid v4/RFC-4122 UUID.
 */
export function assertValidUuid(val: unknown, msg = "Expected a valid UUID"): void {
  assert.equal(typeof val, "string", `${msg}: expected string but got ${typeof val}`);
  assert.ok(UUID_REGEX.test(val as string), `${msg}: "${val}" does not match UUID regex`);
}

/**
 * Asserts that an email address has been masked per the Nexus PII privacy rules.
 * Format: first char + bullet points + last char + @domain
 */
export function assertMaskedEmail(maskedEmail: unknown, originalEmail?: string): void {
  assert.equal(typeof maskedEmail, "string", "Masked email must be a string");
  const str = maskedEmail as string;
  assert.ok(str.includes("@"), `Masked email "${str}" must contain '@'`);
  assert.ok(str.includes("•"), `Masked email "${str}" must contain bullet mask '•'`);

  if (originalEmail) {
    const origDomain = originalEmail.split("@")[1];
    const maskedDomain = str.split("@")[1];
    assert.equal(maskedDomain, origDomain, `Domain should remain intact: ${maskedDomain} vs ${origDomain}`);
  }
}

/**
 * Asserts that a phone number is masked per the Nexus PII privacy rules.
 * Format: +countryCode ••• ••• last4
 */
export function assertMaskedPhone(maskedPhone: unknown, originalPhone?: string): void {
  assert.equal(typeof maskedPhone, "string", "Masked phone must be a string");
  const str = maskedPhone as string;
  assert.ok(str.includes("•"), `Masked phone "${str}" must contain bullet mask '•'`);

  if (originalPhone && originalPhone.length >= 7) {
    const origLast4 = originalPhone.slice(-4);
    assert.ok(str.endsWith(origLast4), `Masked phone "${str}" must end with last 4 digits: ${origLast4}`);
  }
}

/**
 * Asserts that a workspace invite code conforms to Crockford Base-32 rules:
 * - Only characters from 0123456789ABCDEFGHJKMNPQRSTVWXYZ and optional hyphens.
 * - Excludes ambiguous letters I, L, O, U.
 */
export function assertCrockfordBase32(code: unknown): void {
  assert.equal(typeof code, "string", "Invite code must be a string");
  const str = (code as string).toUpperCase();
  assert.ok(str.length >= 4, `Invite code too short: ${str}`);
  for (const ch of str) {
    assert.ok(
      CROCKFORD_ALPHABET.has(ch),
      `Character '${ch}' in code '${str}' is not a valid Crockford Base-32 character`
    );
  }
}

/**
 * Asserts HTTP status code matches expected.
 */
export function assertHttpStatus(actual: number, expected: number, context = ""): void {
  assert.equal(
    actual,
    expected,
    `HTTP Status mismatch${context ? ` in ${context}` : ""}: expected ${expected}, got ${actual}`
  );
}

/**
 * Asserts that an error response body contains the expected substring.
 */
export function assertErrorMessage(body: unknown, expectedSubstr: string): void {
  assert.ok(body && typeof body === "object", "Error response body must be an object");
  const errText =
    (body as Record<string, unknown>).error ||
    (body as Record<string, unknown>).message ||
    JSON.stringify(body);
  assert.ok(
    typeof errText === "string" && errText.toLowerCase().includes(expectedSubstr.toLowerCase()),
    `Error "${errText}" does not contain expected substring "${expectedSubstr}"`
  );
}
