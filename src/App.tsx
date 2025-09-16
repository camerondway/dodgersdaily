import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  IconButton,
  Popover,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Toolbar,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'

const DODGERS_TEAM_ID = 119
const NL_WEST_DIVISION_ID = 203
const SCHEDULE_ENDPOINT = 'https://statsapi.mlb.com/api/v1/schedule'
const GAME_CONTENT_ENDPOINT = 'https://statsapi.mlb.com/api/v1/game'
const STANDINGS_ENDPOINT = 'https://statsapi.mlb.com/api/v1/standings'
const FALLBACK_STREAMABLE =
  'https://streamable.com/m/condensed-game-lad-sf-9-14-25?partnerId=web_video-playback-page_video-share'

type RawGameTeam = {
  team: {
    id: number
    name?: string
    teamName?: string
  }
  score?: number
}

interface RawGame {
  gamePk: number
  gameDate: string
  status?: {
    statusCode?: string
    abstractGameState?: string
    detailedState?: string
  }
  teams: {
    home: RawGameTeam
    away: RawGameTeam
  }
  venue?: {
    name?: string
  }
}

type ScheduleDate = {
  games?: RawGame[]
}

type ScheduleResponse = {
  dates?: ScheduleDate[]
}

type Playback = {
  name?: string
  url?: string
}

type MediaItem = {
  type?: string
  title?: string
  headline?: string
  blurb?: string
  description?: string
  caption?: string
  url?: string
  playbackUrl?: string
  slug?: string
  mediaPlaybackType?: string
  keywords?: Array<{
    type?: string
    value?: string
  }>
  playbacks?: Playback[]
}

type MediaChannel = {
  items?: MediaItem[]
}

type GameContent = {
  media?: {
    epg?: MediaChannel[]
    epgAlternate?: MediaChannel[]
  }
}

type GameDetails = {
  isoDate: string
  displayDate: string
  opponent: string
  homeAway: 'home' | 'away'
  venue?: string
  dodgersScore?: number
  opponentScore?: number
  outcome?: 'Win' | 'Loss' | 'Tie'
  statusText?: string
  videoUrl?: string
  embedUrl?: string
  headline?: string
  description?: string
}

type NextGameDetails = {
  isoDate: string
  displayDateTime: string
  opponent: string
  homeAway: 'home' | 'away'
  venue?: string
  opponentStanding?: string
}

type StandingsTeamRecord = {
  team?: {
    id?: number
    name?: string
    teamName?: string
    shortName?: string
    abbreviation?: string
  }
  wins?: number
  losses?: number
  winningPercentage?: string
  gamesBack?: string
  divisionRank?: string
  division?: {
    id?: number
    nameShort?: string
    name?: string
  }
}

type StandingsResponse = {
  records?: Array<{
    teamRecords?: StandingsTeamRecord[]
  }>
}

const FINAL_STATUS_CODES = new Set(['F', 'FR', 'O', 'S', 'X'])

const pacificIsoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
})

const pacificDisplayFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'full',
  timeZone: 'America/Los_Angeles',
})

const pacificMonthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Los_Angeles',
})

const pacificWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'America/Los_Angeles',
})

const pacificOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Los_Angeles',
  timeZoneName: 'shortOffset',
})

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const getDateFromLocation = () => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const url = new URL(window.location.href)
    const dateParam = (url.searchParams.get('date') ?? '').trim()

    if (ISO_DATE_PATTERN.test(dateParam)) {
      return dateParam
    }
  } catch {
    // Ignore URL parsing errors and fall back to default selection.
  }

  return null
}

const updateDateInUrl = (isoDate: string, replace = false) => {
  if (typeof window === 'undefined' || !ISO_DATE_PATTERN.test(isoDate)) {
    return
  }

  const { history } = window
  if (!history || typeof history.pushState !== 'function') {
    return
  }

  const url = new URL(window.location.href)
  const currentValue = url.searchParams.get('date')
  url.searchParams.set('date', isoDate)
  const newUrl = `${url.pathname}${url.search}${url.hash}`

  if (replace) {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUrl !== newUrl) {
      history.replaceState(history.state, '', newUrl)
    }
    return
  }

  if (currentValue !== isoDate) {
    history.pushState(history.state, '', newUrl)
  }
}

const parseGmtOffsetMinutes = (offsetText: string) => {
  const match = offsetText.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
  if (!match) {
    return -480
  }

  const sign = match[1].startsWith('-') ? -1 : 1
  const hours = Math.abs(parseInt(match[1], 10))
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  return sign * (hours * 60 + minutes)
}

const getPacificOffsetMinutes = (() => {
  const cache = new Map<string, number>()

  return (isoDate: string) => {
    const cached = cache.get(isoDate)
    if (typeof cached === 'number') {
      return cached
    }

    const base = new Date(`${isoDate}T00:00:00Z`)
    if (Number.isNaN(base.getTime())) {
      return -480
    }

    const offsetPart = pacificOffsetFormatter
      .formatToParts(base)
      .find((part) => part.type === 'timeZoneName')?.value
    const offset = parseGmtOffsetMinutes(offsetPart ?? '')
    cache.set(isoDate, offset)
    return offset
  }
})()

const createDateFromIso = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day)
  ) {
    const offsetMinutes = getPacificOffsetMinutes(isoDate)
    const utcMillis = Date.UTC(year, month - 1, day)
    return new Date(utcMillis - offsetMinutes * 60 * 1000)
  }

  const fallback = new Date(isoDate)
  if (!Number.isNaN(fallback.getTime())) {
    return fallback
  }

  return new Date()
}

const formatDisplayDate = (isoDate: string) =>
  pacificDisplayFormatter.format(createDateFromIso(isoDate))

const formatPacificIso = (date: Date) => pacificIsoFormatter.format(date)

const startOfMonth = (date: Date) =>
  createDateFromIso(`${formatPacificIso(date).slice(0, 7)}-01`)

const addMonths = (date: Date, delta: number) => {
  const iso = formatPacificIso(date)
  const [yearString, monthString] = iso.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthString) - 1
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return date
  }

  const next = new Date(Date.UTC(year, monthIndex + delta, 1))
  const nextIso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
  return createDateFromIso(nextIso)
}

const addPacificDays = (date: Date, amount: number) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

const getPacificDayOfWeek = (date: Date) => {
  const label = pacificWeekdayFormatter.format(date)
  const index = WEEKDAY_LABELS.indexOf(label)
  return index >= 0 ? index : 0
}

const endOfMonth = (date: Date) =>
  addPacificDays(addMonths(startOfMonth(date), 1), -1)

const buildCalendarDays = (monthDate: Date) => {
  const firstOfMonth = startOfMonth(monthDate)
  const firstDayOffset = getPacificDayOfWeek(firstOfMonth)
  const firstVisibleDate = addPacificDays(firstOfMonth, -firstDayOffset)
  const currentMonthPrefix = formatPacificIso(firstOfMonth).slice(0, 7)

  const days = [] as Array<{
    date: Date
    iso: string
    inCurrentMonth: boolean
  }>

  for (let index = 0; index < 42; index += 1) {
    const current = addPacificDays(firstVisibleDate, index)
    const iso = formatPacificIso(current)
    days.push({
      date: current,
      iso,
      inCurrentMonth: iso.startsWith(currentMonthPrefix),
    })
  }

  return days
}

const getPreviousDodgersDate = () => {
  const now = new Date()
  const pacificNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  )
  pacificNow.setDate(pacificNow.getDate() - 1)
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(pacificNow)
  const displayDate = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeZone: 'America/Los_Angeles',
  }).format(pacificNow)
  return { isoDate, displayDate }
}

const getPacificNow = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

const formatUpcomingGameDateTime = (isoDate: string) => {
  const date = new Date(isoDate)
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  })

  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)} PT`
}

const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' })
const ordinalSuffixes: Record<string, string> = {
  one: 'st',
  two: 'nd',
  few: 'rd',
  other: 'th',
}

const formatOrdinal = (value?: string | number) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return undefined
  }

  const suffix = ordinalSuffixes[ordinalRules.select(numericValue)] ?? 'th'
  return `${numericValue}${suffix}`
}

const formatOpponentStanding = (record?: StandingsTeamRecord) => {
  if (!record) {
    return undefined
  }

  const wins = typeof record.wins === 'number' ? record.wins : undefined
  const losses = typeof record.losses === 'number' ? record.losses : undefined
  const divisionRank = formatOrdinal(record.divisionRank)
  const divisionName = record.division?.nameShort ?? record.division?.name

  const parts: string[] = []
  if (typeof wins === 'number' && typeof losses === 'number') {
    parts.push(`${wins}-${losses}`)
  }
  if (divisionRank && divisionName) {
    parts.push(`${divisionRank} in ${divisionName}`)
  } else if (divisionRank) {
    parts.push(`${divisionRank} place`)
  }

  if (parts.length === 0) {
    return undefined
  }

  return parts.join(', ')
}

const formatWinningPercentage = (
  winningPercentage?: string,
  wins?: number,
  losses?: number,
) => {
  if (winningPercentage) {
    const trimmed = winningPercentage.trim()
    if (trimmed) {
      const numeric = Number(trimmed)
      if (Number.isFinite(numeric)) {
        return numeric.toFixed(3).replace(/^0/, '.')
      }
      if (/^\.\d+$/.test(trimmed)) {
        return trimmed
      }
    }
  }

  if (typeof wins === 'number' && typeof losses === 'number') {
    const total = wins + losses
    if (total > 0) {
      return (wins / total).toFixed(3).replace(/^0/, '.')
    }
  }

  return undefined
}

const getTeamDisplayName = (record: StandingsTeamRecord) =>
  record.team?.teamName ??
  record.team?.name ??
  record.team?.shortName ??
  record.team?.abbreviation ??
  'Team'

const isCompletedGame = (game: RawGame) => {
  const statusCode = game.status?.statusCode?.toUpperCase() ?? ''
  const abstractState = game.status?.abstractGameState?.toLowerCase() ?? ''
  const detailedState = game.status?.detailedState?.toLowerCase() ?? ''

  return (
    FINAL_STATUS_CODES.has(statusCode) ||
    abstractState === 'final' ||
    detailedState.includes('final') ||
    detailedState.includes('completed')
  )
}

const isCondensedItem = (item?: MediaItem) => {
  if (!item) {
    return false
  }

  const sampleValues = [
    item.type,
    item.mediaPlaybackType,
    item.title,
    item.headline,
    item.slug,
  ]
    .filter(Boolean)
    .map((value) => value!.toLowerCase())

  if (sampleValues.some((value) => value.includes('condensed'))) {
    return true
  }

  if (item.keywords) {
    return item.keywords.some((keyword) =>
      keyword?.value?.toLowerCase().includes('condensed'),
    )
  }

  return false
}

const normalizeUrl = (url?: string) =>
  typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : undefined

const pickPlaybackUrl = (playbacks?: Playback[]) => {
  if (!playbacks || playbacks.length === 0) {
    return undefined
  }

  const preferredOrder = [
    'mp4avcadaptive',
    'mp4avchd',
    'mp4avc',
    'mp4',
    'http_cloud_mobile',
    'http_cloud_tablet',
  ]

  for (const label of preferredOrder) {
    const match = playbacks.find((playback) =>
      playback?.name?.toLowerCase().includes(label),
    )
    if (match?.url) {
      return normalizeUrl(match.url)
    }
  }

  const directMp4 = playbacks.find((playback) =>
    playback?.url?.toLowerCase().endsWith('.mp4'),
  )
  if (directMp4?.url) {
    return normalizeUrl(directMp4.url)
  }

  return normalizeUrl(playbacks[0]?.url)
}

const pickEmbedUrl = (playbacks?: Playback[]) => {
  if (!playbacks) {
    return undefined
  }

  const iframePlayback = playbacks.find((playback) =>
    playback?.url?.includes('iframe'),
  )

  if (iframePlayback?.url) {
    return normalizeUrl(iframePlayback.url)
  }

  return undefined
}

function App() {
  const urlDate = useMemo(getDateFromLocation, [])
  const fallbackDate = useMemo(getPreviousDodgersDate, [])
  const initialSelectedIso = urlDate ?? fallbackDate.isoDate
  const [selectedDateIso, setSelectedDateIso] = useState(initialSelectedIso)
  const [calendarMonth, setCalendarMonth] = useState(() =>
    startOfMonth(createDateFromIso(initialSelectedIso)),
  )
  const [monthGames, setMonthGames] = useState<Record<string, RawGame[]>>({})
  const [monthLoading, setMonthLoading] = useState(true)
  const [monthError, setMonthError] = useState<string | null>(null)
  const [calendarAnchorEl, setCalendarAnchorEl] = useState<HTMLElement | null>(null)
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noGame, setNoGame] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [showSpoilers, setShowSpoilers] = useState(false)
  const [nextGameDetails, setNextGameDetails] =
    useState<NextGameDetails | null>(null)
  const [nextGameLoading, setNextGameLoading] = useState(true)
  const [nextGameError, setNextGameError] = useState<string | null>(null)
  const [noUpcomingGame, setNoUpcomingGame] = useState(false)
  const [nlWestStandings, setNlWestStandings] = useState<StandingsTeamRecord[]>([])
  const [standingsLoading, setStandingsLoading] = useState(true)
  const [standingsError, setStandingsError] = useState<string | null>(null)
  const [latestGameIso, setLatestGameIso] = useState<string | null>(null)
  const [latestGameLoading, setLatestGameLoading] = useState(true)
  const [latestGameError, setLatestGameError] = useState<string | null>(null)

  const userSelectionRef = useRef<boolean>(Boolean(urlDate))
  const appliedLatestIsoRef = useRef<string | null>(null)

  const selectedDisplayDate = useMemo(
    () => formatDisplayDate(selectedDateIso),
    [selectedDateIso],
  )

  const latestGameDisplayDate = useMemo(
    () => (latestGameIso ? formatDisplayDate(latestGameIso) : null),
    [latestGameIso],
  )

  const calendarDays = useMemo(
    () => buildCalendarDays(calendarMonth),
    [calendarMonth],
  )

  const calendarOpen = Boolean(calendarAnchorEl)

  const sortedNlWestStandings = useMemo(
    () =>
      [...nlWestStandings].sort((a, b) => {
        const rankA = Number(a.divisionRank)
        const rankB = Number(b.divisionRank)
        if (Number.isFinite(rankA) && Number.isFinite(rankB)) {
          return rankA - rankB
        }
        if (Number.isFinite(rankA)) {
          return -1
        }
        if (Number.isFinite(rankB)) {
          return 1
        }
        return getTeamDisplayName(a).localeCompare(getTeamDisplayName(b))
      }),
    [nlWestStandings],
  )

  const applyDateSelection = useCallback(
    (
      isoDate: string,
      {
        historyMode = 'push',
        closeCalendar = true,
      }: {
        historyMode?: 'push' | 'replace' | 'skip'
        closeCalendar?: boolean
      } = {},
    ) => {
      setSelectedDateIso((current) => (current === isoDate ? current : isoDate))
      setCalendarMonth((current) => {
        const nextMonth = startOfMonth(createDateFromIso(isoDate))
        const nextPrefix = formatPacificIso(nextMonth).slice(0, 7)
        const currentPrefix = formatPacificIso(current).slice(0, 7)

        if (nextPrefix === currentPrefix) {
          return current
        }

        return nextMonth
      })

      if (closeCalendar) {
        setCalendarAnchorEl(null)
      }

      if (historyMode === 'replace') {
        updateDateInUrl(isoDate, true)
      } else if (historyMode === 'push') {
        updateDateInUrl(isoDate, false)
      }
    },
    [],
  )

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const fetchLatestGame = async () => {
      setLatestGameLoading(true)
      setLatestGameError(null)

      try {
        const now = getPacificNow()
        const searchStart = startOfMonth(now)
        let foundIso: string | null = null

        for (let offset = 0; offset < 12 && !foundIso; offset += 1) {
          const monthDate = addMonths(searchStart, -offset)
          const monthStart = monthDate
          const monthEnd = endOfMonth(monthDate)

          const response = await fetch(
            `${SCHEDULE_ENDPOINT}?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${formatPacificIso(monthStart)}&endDate=${formatPacificIso(monthEnd)}`,
            { signal: controller.signal },
          )

          if (!response.ok) {
            throw new Error(`Schedule request failed (${response.status})`)
          }

          const scheduleData: ScheduleResponse = await response.json()
          const games =
            scheduleData.dates?.flatMap((date) => date.games ?? []) ?? []

          const latestCompleted = games
            .filter(isCompletedGame)
            .sort(
              (a, b) =>
                new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime(),
            )
            .find(
              (game) => new Date(game.gameDate).getTime() <= now.getTime(),
            )

          if (latestCompleted) {
            const latestDate = new Date(latestCompleted.gameDate)
            if (!Number.isNaN(latestDate.getTime())) {
              foundIso = formatPacificIso(latestDate)
            }
          }
        }

        if (!active) {
          return
        }

        if (!foundIso) {
          setLatestGameIso(null)
          setLatestGameError('No completed games found yet this season.')
          return
        }

        setLatestGameIso(foundIso)
      } catch (err) {
        if (!active) {
          return
        }

        const error = err as Error
        if (error.name === 'AbortError') {
          return
        }

        setLatestGameIso(null)
        setLatestGameError(error.message)
      } finally {
        if (active) {
          setLatestGameLoading(false)
        }
      }
    }

    fetchLatestGame()

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshToken])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const fetchMonthGames = async () => {
      setMonthLoading(true)
      setMonthError(null)
      setMonthGames({})

      try {
        const monthStart = startOfMonth(calendarMonth)
        const monthEnd = endOfMonth(calendarMonth)

        const response = await fetch(
          `${SCHEDULE_ENDPOINT}?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${formatPacificIso(monthStart)}&endDate=${formatPacificIso(monthEnd)}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error(`Schedule request failed (${response.status})`)
        }

        const scheduleData: ScheduleResponse = await response.json()
        const gamesByDate: Record<string, RawGame[]> = {}

        for (const scheduleDate of scheduleData.dates ?? []) {
          for (const game of scheduleDate.games ?? []) {
            const gameDate = new Date(game.gameDate)
            if (Number.isNaN(gameDate.getTime())) {
              continue
            }

            const iso = formatPacificIso(gameDate)
            if (!gamesByDate[iso]) {
              gamesByDate[iso] = []
            }
            gamesByDate[iso].push(game)
          }
        }

        if (!active) {
          return
        }

        setMonthGames(gamesByDate)
      } catch (err) {
        if (!active) {
          return
        }

        const error = err as Error
        if (error.name === 'AbortError') {
          return
        }

        setMonthError(error.message)
      } finally {
        if (active) {
          setMonthLoading(false)
        }
      }
    }

    fetchMonthGames()

    return () => {
      active = false
      controller.abort()
    }
  }, [calendarMonth, refreshToken])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const fetchStandings = async () => {
      setStandingsLoading(true)
      setStandingsError(null)
      setNlWestStandings([])

      try {
        const season = getPacificNow().getFullYear()
        const response = await fetch(
          `${STANDINGS_ENDPOINT}?leagueId=104&season=${season}&standingsTypes=regularSeason`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error(`Standings request failed (${response.status})`)
        }

        const standingsData: StandingsResponse = await response.json()
        const records =
          standingsData.records
            ?.flatMap((record) => record.teamRecords ?? [])
            .filter((record) => {
              const divisionId = record.division?.id
              if (typeof divisionId === 'number') {
                return divisionId === NL_WEST_DIVISION_ID
              }

              const divisionName =
                record.division?.nameShort ?? record.division?.name ?? ''
              return divisionName.toLowerCase().includes('west')
            }) ?? []

        if (!active) {
          return
        }

        if (records.length === 0) {
          setStandingsError('Standings data is not available right now.')
          return
        }

        setNlWestStandings(records)
      } catch (err) {
        if (!active) {
          return
        }

        const error = err as Error
        if (error.name === 'AbortError') {
          return
        }

        setStandingsError(error.message)
      } finally {
        if (active) {
          setStandingsLoading(false)
        }
      }
    }

    fetchStandings()

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshToken])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const fetchNextGame = async () => {
      setNextGameLoading(true)
      setNextGameError(null)
      setNoUpcomingGame(false)
      setNextGameDetails(null)

      try {
        const pacificNow = getPacificNow()
        const startDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Los_Angeles',
        }).format(pacificNow)
        const endDateTarget = new Date(pacificNow)
        endDateTarget.setDate(endDateTarget.getDate() + 14)
        const endDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Los_Angeles',
        }).format(endDateTarget)

        const response = await fetch(
          `${SCHEDULE_ENDPOINT}?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${startDate}&endDate=${endDate}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error(`Next game request failed (${response.status})`)
        }

        const scheduleData: ScheduleResponse = await response.json()
        const games =
          scheduleData.dates?.flatMap((date) => date.games ?? []) ?? []
        const nowTime = pacificNow.getTime()
        const upcomingGame = [...games]
          .filter((game) => !isCompletedGame(game))
          .filter((game) => new Date(game.gameDate).getTime() >= nowTime)
          .sort(
            (a, b) =>
              new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime(),
          )[0]

        if (!upcomingGame) {
          if (active) {
            setNoUpcomingGame(true)
          }
          return
        }

        const dodgersAreHome =
          upcomingGame.teams.home.team.id === DODGERS_TEAM_ID
        const opponentTeam =
          upcomingGame.teams[dodgersAreHome ? 'away' : 'home'].team
        const opponentName =
          opponentTeam?.teamName ?? opponentTeam?.name ?? 'Opposing Team'
        let opponentStanding: string | undefined

        try {
          const season = new Date(upcomingGame.gameDate).getFullYear()
          const standingsResponse = await fetch(
            `${STANDINGS_ENDPOINT}?leagueId=103,104&season=${season}&standingsTypes=regularSeason`,
            { signal: controller.signal },
          )

          if (standingsResponse.ok) {
            const standingsData: StandingsResponse =
              await standingsResponse.json()
            const standingsRecord = standingsData.records
              ?.flatMap((record) => record.teamRecords ?? [])
              .find((record) => record.team?.id === opponentTeam.id)
            opponentStanding = formatOpponentStanding(standingsRecord)
          }
        } catch (standingsError) {
          if ((standingsError as Error).name !== 'AbortError') {
            console.error(standingsError)
          }
        }

        if (!active) {
          return
        }

        setNextGameDetails({
          isoDate: upcomingGame.gameDate,
          displayDateTime: formatUpcomingGameDateTime(upcomingGame.gameDate),
          opponent: opponentName,
          homeAway: dodgersAreHome ? 'home' : 'away',
          venue: upcomingGame.venue?.name,
          opponentStanding,
        })
      } catch (err) {
        if (!active) {
          return
        }

        const error = err as Error
        if (error.name === 'AbortError') {
          return
        }

        setNextGameError(error.message)
      } finally {
        if (active) {
          setNextGameLoading(false)
        }
      }
    }

    fetchNextGame()

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshToken])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      setNoGame(false)
      setGameDetails(null)

      try {
        const scheduleResponse = await fetch(
          `${SCHEDULE_ENDPOINT}?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${selectedDateIso}&endDate=${selectedDateIso}`,
          { signal: controller.signal },
        )

        if (!scheduleResponse.ok) {
          throw new Error(`Schedule request failed (${scheduleResponse.status})`)
        }

        const scheduleData: ScheduleResponse = await scheduleResponse.json()
        const games =
          scheduleData.dates?.flatMap((date) => date.games ?? []) ?? []

        const completedGame = [...games]
          .filter(isCompletedGame)
          .sort(
            (a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime(),
          )[0]

        if (!completedGame) {
          if (active) {
            setNoGame(true)
          }
          return
        }

        const dodgersAreHome =
          completedGame.teams.home.team.id === DODGERS_TEAM_ID
        const opponentTeam =
          completedGame.teams[dodgersAreHome ? 'away' : 'home'].team
        const dodgersScore = completedGame.teams[
          dodgersAreHome ? 'home' : 'away'
        ].score
        const opponentScore = completedGame.teams[
          dodgersAreHome ? 'away' : 'home'
        ].score

        let videoUrl: string | undefined
        let embedUrl: string | undefined
        let headline: string | undefined
        let description: string | undefined

        try {
          const contentResponse = await fetch(
            `${GAME_CONTENT_ENDPOINT}/${completedGame.gamePk}/content`,
            { signal: controller.signal },
          )

          if (contentResponse.ok) {
            const contentData: GameContent = await contentResponse.json()
            const channels = [
              ...(contentData.media?.epg ?? []),
              ...(contentData.media?.epgAlternate ?? []),
            ]

            const condensedItem = channels
              .flatMap((channel) => channel.items ?? [])
              .find(isCondensedItem)

            if (condensedItem) {
              headline =
                condensedItem.headline ??
                condensedItem.title ??
                condensedItem.caption
              description =
                condensedItem.blurb ??
                condensedItem.description ??
                condensedItem.caption
              videoUrl = pickPlaybackUrl(condensedItem.playbacks)

              if (!videoUrl && condensedItem.url) {
                videoUrl = normalizeUrl(condensedItem.url)
              }

              embedUrl =
                pickEmbedUrl(condensedItem.playbacks) ??
                normalizeUrl(condensedItem.playbackUrl)
            }
          }
        } catch (contentError) {
          if ((contentError as Error).name !== 'AbortError') {
            console.error(contentError)
          }
        }

        if (!videoUrl && !embedUrl) {
          embedUrl = FALLBACK_STREAMABLE
        }

        if (!active) {
          return
        }

        setGameDetails({
          isoDate: selectedDateIso,
          displayDate: selectedDisplayDate,
          opponent:
            opponentTeam?.teamName ?? opponentTeam?.name ?? 'Opposing Team',
          homeAway: dodgersAreHome ? 'home' : 'away',
          venue: completedGame.venue?.name,
          dodgersScore,
          opponentScore,
          outcome:
            typeof dodgersScore === 'number' && typeof opponentScore === 'number'
              ? dodgersScore === opponentScore
                ? 'Tie'
                : dodgersScore > opponentScore
                  ? 'Win'
                  : 'Loss'
              : undefined,
          statusText:
            completedGame.status?.detailedState ??
            completedGame.status?.abstractGameState,
          videoUrl,
          embedUrl,
          headline,
          description,
        })
      } catch (err) {
        if (!active) {
          return
        }

        const error = err as Error
        if (error.name === 'AbortError') {
          return
        }

        setError(error.message)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      active = false
      controller.abort()
    }
  }, [selectedDateIso, selectedDisplayDate, refreshToken])

  useEffect(() => {
    if (!latestGameIso) {
      return
    }

    if (userSelectionRef.current) {
      return
    }

    if (appliedLatestIsoRef.current === latestGameIso) {
      return
    }

    appliedLatestIsoRef.current = latestGameIso
    userSelectionRef.current = false
    applyDateSelection(latestGameIso, {
      historyMode: 'replace',
      closeCalendar: false,
    })
  }, [latestGameIso, applyDateSelection])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePopState = () => {
      const isoFromUrl = getDateFromLocation()
      if (isoFromUrl) {
        userSelectionRef.current = true
        applyDateSelection(isoFromUrl, {
          historyMode: 'skip',
          closeCalendar: false,
        })
        return
      }

      userSelectionRef.current = false

      if (latestGameIso) {
        appliedLatestIsoRef.current = latestGameIso
        applyDateSelection(latestGameIso, {
          historyMode: 'skip',
          closeCalendar: false,
        })
        return
      }

      appliedLatestIsoRef.current = null
      applyDateSelection(getPreviousDodgersDate().isoDate, {
        historyMode: 'skip',
        closeCalendar: false,
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [applyDateSelection, latestGameIso])

  const handleRefresh = () => {
    setRefreshToken((token) => token + 1)
  }

  const handleCalendarButtonClick = (event: ReactMouseEvent<HTMLElement>) => {
    setCalendarAnchorEl((current) => (current ? null : event.currentTarget))
  }

  const handleCalendarClose = () => {
    setCalendarAnchorEl(null)
  }

  const handleMonthShift = (delta: number) => {
    setCalendarMonth((current) => addMonths(current, delta))
  }

  const handleDateSelect = (isoDate: string) => {
    userSelectionRef.current = true
    appliedLatestIsoRef.current = null
    applyDateSelection(isoDate)
  }

  const handleLatestGameClick = () => {
    if (!latestGameIso) {
      return
    }

    userSelectionRef.current = false
    appliedLatestIsoRef.current = latestGameIso
    applyDateSelection(latestGameIso)
  }

  const outcomeColor =
    gameDetails?.outcome === 'Win'
      ? 'success'
      : gameDetails?.outcome === 'Loss'
        ? 'error'
        : 'warning'

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="static" color="primary" enableColorOnDark>
        <Toolbar>
          <SportsBaseballIcon sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Dodgers Daily Replay
          </Typography>
          <Button
            color="inherit"
            startIcon={<CalendarMonthIcon />}
            onClick={handleCalendarButtonClick}
            aria-haspopup="true"
            aria-expanded={calendarOpen ? 'true' : undefined}
            sx={{ mr: 2, whiteSpace: 'nowrap' }}
          >
            Select Game Date
          </Button>
          <FormControlLabel
            control={
              <Switch
                color="default"
                checked={showSpoilers}
                onChange={(event) => setShowSpoilers(event.target.checked)}
              />
            }
            label="Spoilers"
            sx={{ color: 'inherit', mr: 2 }}
          />
          <Button
            color="inherit"
            onClick={handleRefresh}
            startIcon={<RefreshIcon />}
            disabled={loading}
          >
            Refresh
          </Button>
        </Toolbar>
      </AppBar>

      <Popover
        open={calendarOpen}
        anchorEl={calendarAnchorEl}
        onClose={handleCalendarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: {
            width: 360,
            maxWidth: '90vw',
            p: 2,
            borderRadius: 2,
          },
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <IconButton
              aria-label="Previous month"
              onClick={() => handleMonthShift(-1)}
              size="small"
            >
              <ChevronLeftIcon />
            </IconButton>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">
                {pacificMonthFormatter.format(calendarMonth)}
              </Typography>
              {monthLoading && <CircularProgress size={18} thickness={5} />}
            </Stack>
            <IconButton
              aria-label="Next month"
              onClick={() => handleMonthShift(1)}
              size="small"
            >
              <ChevronRightIcon />
            </IconButton>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Selected Game: {selectedDisplayDate}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Latest Completed Game:{' '}
            {latestGameLoading
              ? 'Loading...'
              : latestGameDisplayDate ?? 'Unavailable'}
          </Typography>
          {monthError && (
            <Alert severity="warning">
              Unable to mark game days right now. {monthError}
            </Alert>
          )}
          {latestGameError && (
            <Alert severity="info">
              Unable to load the latest game right now. {latestGameError}
            </Alert>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 1,
            }}
          >
            {WEEKDAY_LABELS.map((label) => (
              <Typography
                key={label}
                variant="caption"
                textAlign="center"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {label}
              </Typography>
            ))}
            {calendarDays.map((day) => {
              const isSelected = day.iso === selectedDateIso
              const hasGame = Boolean(monthGames[day.iso]?.length)

              return (
                <Box
                  key={day.iso}
                  component="button"
                  type="button"
                  onClick={() => handleDateSelect(day.iso)}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.75,
                    px: 0.5,
                    py: 1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    bgcolor: isSelected
                      ? 'primary.main'
                      : day.inCurrentMonth
                        ? 'background.paper'
                        : 'background.default',
                    color: isSelected
                      ? 'primary.contrastText'
                      : day.inCurrentMonth
                        ? 'text.primary'
                        : 'text.secondary',
                    opacity: day.inCurrentMonth ? 1 : 0.7,
                    cursor: 'pointer',
                    textDecoration: 'none',
                    outline: 'none',
                    transition: 'border-color 0.2s ease, background-color 0.2s ease',
                    font: 'inherit',
                    width: '100%',
                    margin: 0,
                    minHeight: 64,
                    '&:hover': {
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <Typography
                    variant="body2"
                    fontWeight={isSelected ? 700 : undefined}
                  >
                    {day.date.getDate()}
                  </Typography>
                  {hasGame && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: isSelected
                          ? 'primary.contrastText'
                          : 'success.main',
                      }}
                    />
                  )}
                </Box>
              )
            })}
          </Box>
          <Stack
            direction="row"
            spacing={1}
            justifyContent="flex-end"
            flexWrap="wrap"
          >
            <Button
              onClick={handleLatestGameClick}
              variant="contained"
              size="small"
              disabled={
                latestGameLoading ||
                !latestGameIso ||
                selectedDateIso === latestGameIso
              }
            >
              Latest Game
            </Button>
            <Button onClick={handleCalendarClose} variant="outlined" size="small">
              Close
            </Button>
          </Stack>
        </Stack>
      </Popover>

      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <Stack spacing={3}>
          <Box textAlign="center">
            {nextGameLoading && (
              <Typography variant="body2" color="text.secondary">
                Loading next game details...
              </Typography>
            )}
            {nextGameError && !nextGameLoading && (
              <Typography variant="body2" color="error">
                Unable to load the next game right now. {nextGameError}
              </Typography>
            )}
            {noUpcomingGame && !nextGameLoading && (
              <Typography variant="body2" color="text.secondary">
                No upcoming Dodgers games are currently on the schedule.
              </Typography>
            )}
            {nextGameDetails && !nextGameLoading && (
              <Typography variant="subtitle1">
                {`Next Game: Dodgers ${
                  nextGameDetails.homeAway === 'home' ? 'vs' : '@'
                } ${nextGameDetails.opponent} - ${nextGameDetails.displayDateTime}`}
                {nextGameDetails.venue
                  ? ` | ${nextGameDetails.venue}`
                  : ''}
                {nextGameDetails.opponentStanding
                  ? ` (${nextGameDetails.opponent}: ${nextGameDetails.opponentStanding})`
                  : ''}
              </Typography>
            )}
          </Box>
          <Typography variant="h4" component="h1" textAlign="center">
            Condensed Game - {selectedDisplayDate}
          </Typography>

          {loading && (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={handleRefresh}>
                  Retry
                </Button>
              }
            >
              Unable to load the previous game right now. {error}
            </Alert>
          )}

          {noGame && !loading && (
            <Alert severity="info">
              The Dodgers did not play on {selectedDisplayDate}. Check back
              after the next game.
            </Alert>
          )}

          {gameDetails && !loading && (
            <Card elevation={6}>
              <CardHeader
                avatar={<SportsBaseballIcon color="primary" />}
                title={`Dodgers ${
                  gameDetails.homeAway === 'home' ? 'vs' : '@'
                } ${gameDetails.opponent}`}
                subheader={`${gameDetails.displayDate}${
                  gameDetails.venue ? ` | ${gameDetails.venue}` : ''
                }`}
              />
              <CardContent>
                <Stack spacing={2.5}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    {showSpoilers && gameDetails.outcome && (
                      <Chip
                        label={`Dodgers ${gameDetails.outcome}`}
                        color={outcomeColor}
                        sx={{ textTransform: 'uppercase' }}
                      />
                    )}
                    {gameDetails.statusText && (
                      <Chip label={gameDetails.statusText} variant="outlined" />
                    )}
                  </Stack>

                  {!showSpoilers &&
                    (gameDetails.outcome ||
                      (typeof gameDetails.dodgersScore === 'number' &&
                        typeof gameDetails.opponentScore === 'number')) && (
                      <Typography variant="body2" color="text.secondary">
                        Spoilers hidden. Toggle above to reveal the final score.
                      </Typography>
                    )}

                  {showSpoilers &&
                    typeof gameDetails.dodgersScore === 'number' &&
                    typeof gameDetails.opponentScore === 'number' && (
                      <Typography variant="h6">
                        Final Score: Dodgers {gameDetails.dodgersScore} -{' '}
                        {gameDetails.homeAway === 'home' ? 'vs' : '@'}{' '}
                        {gameDetails.opponent} {gameDetails.opponentScore}
                      </Typography>
                    )}

                  <Box
                    sx={{
                      position: 'relative',
                      width: '100%',
                      pt: '56.25%',
                      borderRadius: 2,
                      overflow: 'hidden',
                      bgcolor: 'common.black',
                    }}
                  >
                    {gameDetails.videoUrl ? (
                      <Box
                        component="video"
                        src={gameDetails.videoUrl}
                        controls
                        preload="metadata"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          bgcolor: 'common.black',
                        }}
                      />
                    ) : (
                      <Box
                        component="iframe"
                        src={gameDetails.embedUrl}
                        title={
                          gameDetails.headline ??
                          `Dodgers condensed game ${selectedDisplayDate}`
                        }
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          border: 0,
                        }}
                      />
                    )}
                  </Box>

                  {gameDetails.headline && (
                    <Typography variant="h5">{gameDetails.headline}</Typography>
                  )}

                  {gameDetails.description && (
                    <Typography variant="body1" color="text.secondary">
                      {gameDetails.description}
                    </Typography>
                  )}

                  {!gameDetails.videoUrl && gameDetails.embedUrl && (
                    <Button
                      variant="outlined"
                      startIcon={<OpenInNewIcon />}
                      href={gameDetails.embedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Stream in New Tab
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
          <Accordion>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="nl-west-standings"
              id="nl-west-standings-header"
            >
              <Typography variant="h6" sx={{ flexGrow: 1 }}>
                NL West Standings
              </Typography>
              {!standingsLoading && !standingsError && (
                <Typography variant="body2" color="text.secondary">
                  {`Updated ${new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(getPacificNow())}`}
                </Typography>
              )}
            </AccordionSummary>
            <AccordionDetails>
              {standingsLoading ? (
                <Box display="flex" justifyContent="center" py={2}>
                  <CircularProgress size={24} />
                </Box>
              ) : standingsError ? (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={handleRefresh}>
                      Retry
                    </Button>
                  }
                >
                  Unable to load the NL West standings. {standingsError}
                </Alert>
              ) : sortedNlWestStandings.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Standings data is not available right now.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label="NL West standings">
                    <TableHead>
                      <TableRow>
                        <TableCell>Team</TableCell>
                        <TableCell align="right">W</TableCell>
                        <TableCell align="right">L</TableCell>
                        <TableCell align="right">Pct</TableCell>
                        <TableCell align="right">GB</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedNlWestStandings.map((record) => {
                        const wins =
                          typeof record.wins === 'number'
                            ? record.wins
                            : undefined
                        const losses =
                          typeof record.losses === 'number'
                            ? record.losses
                            : undefined
                        const pct =
                          formatWinningPercentage(
                            record.winningPercentage,
                            wins,
                            losses,
                          ) ?? '--'
                        const gamesBack = record.gamesBack?.trim() || '--'

                        return (
                          <TableRow key={record.team?.id ?? getTeamDisplayName(record)}>
                            <TableCell component="th" scope="row">
                              {getTeamDisplayName(record)}
                            </TableCell>
                            <TableCell align="right">
                              {typeof wins === 'number' ? wins : '--'}
                            </TableCell>
                            <TableCell align="right">
                              {typeof losses === 'number' ? losses : '--'}
                            </TableCell>
                            <TableCell align="right">{pct}</TableCell>
                            <TableCell align="right">{gamesBack}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Container>
    </Box>
  )
}

export default App
