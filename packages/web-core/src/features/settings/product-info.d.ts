declare module 'virtual:coflow-product-info' {
  const info: {
    product: string;
    web: string;
    api: string;
    date: string;
    history: {
      version: string;
      date: string;
      categories: string[];
      changes: string[];
    }[];
  };
  export default info;
}
