export const TOC_DRAWER_BREAKPOINT = 1000;
export const TOC_DRAWER_MEDIA_QUERY = `(max-width: ${TOC_DRAWER_BREAKPOINT - 1}px)`;

export function usesTocDrawer(width: number): boolean {
  return width < TOC_DRAWER_BREAKPOINT;
}
