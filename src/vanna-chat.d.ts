declare namespace JSX {
  interface IntrinsicElements {
    "vanna-chat": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      "api-base"?: string;
      "sse-endpoint"?: string;
      "ws-endpoint"?: string;
      "poll-endpoint"?: string;
    };
  }
}
