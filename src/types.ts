export interface LogEntry {
  id: string
  time: number // seconds
  caption: string
}

export interface ProjectState {
  videoName: string
  entries: LogEntry[]
}
