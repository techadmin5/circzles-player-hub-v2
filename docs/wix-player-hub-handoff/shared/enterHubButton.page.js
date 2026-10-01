// Wix Studio → page code (or masterPage.js) of any page that has the Enter Hub button.
// Replace #enterHubButton with your button's element ID. Identical on circzles.com and circzles.in.
import { authentication, currentMember } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { session } from 'wix-storage-frontend';
import { createPlayerHubHandoff } from 'backend/playerHubHandoff.web';

const PENDING_KEY = 'czEnterHubPending';
let busy = false;

$w.onReady(() => {
  $w('#enterHubButton').onClick(() => enterHub());
  // Fallback: if the login flow reloaded the page, continue once the member is back.
  if (session.getItem(PENDING_KEY) === '1') {
    currentMember.getMember().then((member) => { if (member) enterHub(); });
  }
});

async function enterHub() {
  if (busy) return;
  busy = true;
  try {
    const member = await currentMember.getMember(); // undefined when logged out
    if (!member) {
      session.setItem(PENDING_KEY, '1');
      // Resolves when login/signup completes, rejects if the visitor cancels. No polling needed.
      await authentication.promptLogin({ mode: 'login', modal: true });
    }
    session.removeItem(PENDING_KEY);
    // The BACKEND decides who the member is. Nothing identity-related is sent from here.
    const result = await createPlayerHubHandoff();
    if (result && result.ok && result.url) {
      wixLocationFrontend.to(result.url);
      return;
    }
    showError(result && result.reason);
  } catch (error) {
    session.removeItem(PENDING_KEY); // cancelled login or failed call
    if (!(error && /cancel/i.test(String(error.message || error)))) showError('UNEXPECTED');
  } finally {
    busy = false;
  }
}

function showError(reason) {
  // Replace with your own text element / lightbox.
  console.error('Enter Hub failed:', reason);
}
