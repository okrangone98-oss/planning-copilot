/// <reference types="vite/client" />

declare module "mammoth/mammoth.browser" {
  type MammothMessage = {
    type: string;
    message: string;
  };

  type ExtractRawTextResult = {
    value: string;
    messages: MammothMessage[];
  };

  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
  };

  export default mammoth;
}
