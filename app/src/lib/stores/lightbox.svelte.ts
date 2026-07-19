type LightboxContent = { type: "image"; src: string; alt: string } | { type: "svg"; html: string };

function createLightboxStore() {
  let content = $state<LightboxContent | null>(null);

  return {
    get content() {
      return content;
    },
    get open() {
      return content !== null;
    },
    openImage(src: string, alt: string) {
      content = { type: "image", src, alt };
    },
    openSvg(html: string) {
      content = { type: "svg", html };
    },
    close() {
      content = null;
    },
  };
}

export const lightboxStore = createLightboxStore();
