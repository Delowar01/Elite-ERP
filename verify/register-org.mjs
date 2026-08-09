/**
 * Fill the country and base currency on the registration form.
 *
 * Registration asks for both as of FX-1a, and refuses to create an org without them. Every browser
 * suite that registers a fixture org therefore has to answer, and this is the one place the fiddly
 * widget interaction lives — a `SearchableSelect` whose options are plain <button> rows rendering
 * "{name} · {code}", not role="option".
 *
 * Suites call it between filling the text fields and clicking Create:
 *
 *     await page.fill('input[name="password"]', pass);
 *     await pickCountry(page);            // currency follows the country profile
 *     await page.getByRole("button", { name: /create account/i }).click();
 *
 * The currency is left to follow the country rather than being set here, because that is what a
 * user does and what the product intends; a suite that specifically wants a different base currency
 * picks it itself afterwards.
 */
export async function pickCountry(page, countryName = "Saudi Arabia") {
  await page.locator("#country").click();
  await page.waitForTimeout(300);
  await page.keyboard.type(countryName.slice(0, 12));
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: new RegExp(`^${countryName} ·`) }).first().click();
  await page.waitForTimeout(400);
}
