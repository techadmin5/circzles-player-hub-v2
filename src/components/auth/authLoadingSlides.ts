export interface AuthLoadingSlide {
  id: string;
  title: string;
  description: string;
  label?: string;
  // Local /public assets can replace the CSS visual without changing request behavior.
  media?: { type: "image"; src: string; alt: string } | { type: "video"; src: string; poster?: string };
}

export const AUTH_LOADING_DELAY_MS = 1_200;
export const AUTH_LOADING_ROTATION_MS = 4_000;

export const loginLoadingSlides: readonly AuthLoadingSlide[] = [
  { id: "session", title: "Logging you in", description: "Setting up your secure Player Hub session." },
  { id: "dashboard", title: "Building your dashboard", description: "Loading your profile, progress, and rewards." },
  { id: "puzzles", title: "Loading your CircZles", description: "Fetching your CircZles, submissions, and activity." },
  { id: "experience", title: "Preparing your experience", description: "Bringing your Player Hub features together." },
  { id: "ready", title: "Almost there", description: "Your CircZles Player Hub is getting ready." },
];

// Non-login actions avoid implying that a session or dashboard is being created.
export const emailLoadingSlides: readonly AuthLoadingSlide[] = [
  { id: "request", title: "Connecting to CircZles", description: "Securely processing your request." },
  { id: "email", title: "A little longer", description: "Keep this page open while we finish your request." },
];
