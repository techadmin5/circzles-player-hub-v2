import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthFormNotice, AuthNavigation, AuthNotice, PasswordSetupIntroduction, passwordSetupSentMessage } from "./AuthPresentation.tsx";

const render = (component, props = {}) => renderToStaticMarkup(createElement(component, props));
const text = (html) => html.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
const helper = "Didn't receive the email? Check your spam or junk folder.";

test("login invites new players with a secondary label and the existing signup destination", () => {
  const html = render(AuthNavigation, { mode: "login", returnTo: "/hub?tab=profile&view=security" });
  assert.match(text(html), /New here\? Create an account/);
  assert.match(html, /New here\? <a[^>]*>Create an account<\/a>/);
  assert.ok(html.includes('href="/signup?returnTo=%2Fhub%3Ftab%3Dprofile%26view%3Dsecurity"'));
  assert.ok(html.includes('href="/auth/forgot-password"'));
});

for (const mode of ["signup", "forgot-password"]) {
  test(`${mode} email-sent confirmation includes the informational delivery helper`, () => {
    const html = render(AuthFormNotice, { mode, message: "A link has been sent." });
    assert.ok(text(html).includes(helper));
    assert.ok(html.includes('role="status"'));
    assert.ok(!html.includes('role="alert"'));
    assert.equal(render(AuthFormNotice, { mode, message: "" }), "");
  });
}

test("Google password setup explains email verification and delivery guidance", () => {
  assert.equal(text(render(PasswordSetupIntroduction)), "Create a password so you can also sign in with your email address.");
  const html = render(AuthNotice, { message: passwordSetupSentMessage, emailSent: true });
  assert.ok(text(html).includes("For your security, we've sent a verification link to your email. Open it to finish adding your password."));
  assert.ok(text(html).includes(helper));
});

test("non-email success and failure notices do not show a misleading delivery helper", () => {
  assert.ok(!text(render(AuthFormNotice, { mode: "reset-password", message: "Password reset." })).includes(helper));
  assert.ok(!text(render(AuthNotice, { message: "Could not send email." })).includes(helper));
});

for (const mode of ["signup", "verify", "forgot-password", "reset-password", "set-password"]) {
  test(`${mode} preserves return-to login navigation`, () => {
    const html = render(AuthNavigation, { mode, returnTo: "/hub/security" });
    assert.ok(html.includes('href="/login?returnTo=%2Fhub%2Fsecurity"'));
    assert.ok(text(html).includes("Back to login"));
    if (mode === "verify") {
      // Resend continues through signup, whose sent confirmation uses AuthFormNotice.
      assert.ok(html.includes('href="/signup"'));
      assert.ok(text(html).includes("Request a new verification link"));
    }
  });
}
