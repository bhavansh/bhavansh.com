export function remarkReadingTime() {
  return function (tree: any, { data }: any) {
    let textOnPage = "";

    function extractText(node: any) {
      if (!node) return;
      // Exclude code blocks, inline code, and HTML
      if (
        node.type === "code" ||
        node.type === "inlineCode" ||
        node.type === "html"
      ) {
        return;
      }
      if (node.type === "text") {
        textOnPage += node.value + " ";
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(extractText);
      }
    }

    extractText(tree);

    const words = textOnPage.trim().split(/\s+/).filter(Boolean).length;
    const WORDS_PER_MINUTE = 220;
    const readingTime = Math.ceil(words / WORDS_PER_MINUTE) || 1;

    data.astro.frontmatter.readingTime = `${readingTime} min read`;
  };
}
