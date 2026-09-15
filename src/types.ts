export interface LogEntry {
  id: string
  time: number // seconds
  caption: string
}

export interface ProjectState {
  videoName: string
  title: string
  entries: LogEntry[]
}
