export type WebcamMode = 'video' | 'audio' | 'off'
export type WebcamVertical = 'top' | 'bottom'
export type WebcamHorizontal = 'left' | 'right'

export type WebcamSettings = {
  webcamMode: WebcamMode
  webcamVertical: WebcamVertical
  webcamHorizontal: WebcamHorizontal
}

export const DEFAULT_WEBCAM_SETTINGS: WebcamSettings = {
  webcamMode: 'video',
  webcamVertical: 'bottom',
  webcamHorizontal: 'right',
}
