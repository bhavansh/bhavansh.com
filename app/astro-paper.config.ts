import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://bhavansh.com",
    title: "Bhavansh Gupta",
    description: "My personal website and corner of fun on the internet.",
    author: "Bhavansh Gupta",
    profile: "https://bhavansh.com",
    ogImage: "site-image.png",
    lang: "en",
    timezone: "Asia/Kolkata",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/bhavansh" },
    { name: "x",        url: "https://x.com/bhavanshgupta" },
    { name: "linkedin", url: "https://www.linkedin.com/in/bhavanshgupta/" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x",        url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});