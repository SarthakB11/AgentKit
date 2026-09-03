/**
 * The Lamatic endpoint receives the API key and the plan facts on every
 * request, so it must be HTTPS. Anything else is a configuration error, not a
 * warning: a plain-HTTP endpoint would send the key in clear text.
 */
export function assertHttpsEndpoint(url: string, name = "LAMATIC_API_URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid URL: ${JSON.stringify(url)}.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https:// (got ${parsed.protocol}//). The API key is sent with every request.`);
  }
  return url;
}
