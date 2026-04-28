declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "fluent-ffmpeg" {
  type FfmpegCommand = {
    inputFPS(value: number): FfmpegCommand;
    outputOptions(options: string[]): FfmpegCommand;
    on(event: "end", listener: () => void): FfmpegCommand;
    on(event: "error", listener: (error: Error) => void): FfmpegCommand;
    save(path: string): FfmpegCommand;
  };

  type FfmpegFactory = {
    (input?: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
  };

  const ffmpeg: FfmpegFactory;
  export default ffmpeg;
}
