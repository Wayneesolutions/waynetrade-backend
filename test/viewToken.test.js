const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { hashViewToken, generateViewToken } = require("../src/services/viewToken");

describe("viewToken", () => {
  test("hashViewToken is deterministic — same input, same hash, every time", () => {
    const a = hashViewToken("some-plaintext-token");
    const b = hashViewToken("some-plaintext-token");
    assert.equal(a, b);
  });

  test("hashViewToken is one-way-looking — different inputs produce different hashes", () => {
    const a = hashViewToken("token-one");
    const b = hashViewToken("token-two");
    assert.notEqual(a, b);
  });

  test("generateViewToken's hash matches hashing its own plaintext — this is what requireViewToken relies on", () => {
    const { plaintext, hash } = generateViewToken();
    assert.equal(hashViewToken(plaintext), hash);
  });

  test("generateViewToken produces a different plaintext on every call — no fixed/reused token", () => {
    const first = generateViewToken();
    const second = generateViewToken();
    assert.notEqual(first.plaintext, second.plaintext);
    assert.notEqual(first.hash, second.hash);
  });

  test("plaintext has real entropy — 24 random bytes as hex is 48 characters", () => {
    const { plaintext } = generateViewToken();
    assert.equal(plaintext.length, 48);
    assert.match(plaintext, /^[0-9a-f]{48}$/);
  });
});
