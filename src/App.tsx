import { useEffect, useMemo, useState } from 'react'
import {
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
  Stack,
  Switch,
  Toolbar,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball'

const DODGERS_TEAM_ID = 119
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
  }
  wins?: number
  losses?: number
  divisionRank?: string
  division?: {
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
  const targetDate = useMemo(getPreviousDodgersDate, [])
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
          `${SCHEDULE_ENDPOINT}?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${targetDate.isoDate}&endDate=${targetDate.isoDate}`,
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
          isoDate: targetDate.isoDate,
          displayDate: targetDate.displayDate,
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
  }, [targetDate.isoDate, targetDate.displayDate, refreshToken])

  const handleRefresh = () => {
    setRefreshToken((token) => token + 1)
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
            Previous Game - {targetDate.displayDate}
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
              The Dodgers did not play on {targetDate.displayDate}. Check back
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
                          `Dodgers condensed game ${targetDate.displayDate}`
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
        </Stack>
      </Container>
    </Box>
  )
}

export default App
