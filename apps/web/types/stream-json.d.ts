declare module "stream-json" {
  const streamJson: {
    parser: (...args: any[]) => any;
  };

  export default streamJson;
}

declare module "stream-json/streamers/StreamArray.js" {
  const streamArrayModule: {
    streamArray: (...args: any[]) => any;
  };

  export default streamArrayModule;
}
