import { test } from "node:test";
import assert from "node:assert/strict";
import { assertHttpsEndpoint } from "./endpoint";

test("only https endpoints are accepted", () => {
  assert.equal(assertHttpsEndpoint("https://example.lamatic.dev/graphql"), "https://example.lamatic.dev/graphql");
  assert.throws(() => assertHttpsEndpoint("http://example.lamatic.dev/graphql"), /must use https/);
  assert.throws(() => assertHttpsEndpoint("ftp://example.lamatic.dev/graphql"), /must use https/);
  assert.throws(() => assertHttpsEndpoint("example.lamatic.dev/graphql"), /not a valid URL/);
});
