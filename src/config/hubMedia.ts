export interface HubMediaConfig { videoSrc: string | null; posterSrc: string | null }

// Put future assets in public/media/, then set these to the paths below.
// Null avoids requests for assets that have not been supplied yet.
export const hubMedia: HubMediaConfig = {
  videoSrc: null, // "/media/hub-background.mp4"
  posterSrc: null, // "/media/hub-background-poster.jpg"
};
