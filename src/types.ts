export interface LogEntry {
  id: string
  time: number // seconds, position in the source video
  clockTime: string // shooting time shown as overlay, e.g. "11:00"
  caption: string
}

export interface ProjectState {
  videoName: string
  entries: LogEntry[]
}
