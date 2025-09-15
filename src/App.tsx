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
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SportsBaseballIcon from '@mui/icons-material/SportsBaseball'

const DODGERS_TEAM_ID = 119
const SCHEDULE_ENDPOINT = 'https://statsapi.mlb.com/api/v1/schedule'
const GAME_CONTENT_ENDPOINT = 'https://statsapi.mlb.com/api/v1/game'
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
                    {gameDetails.outcome && (
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

                  {typeof gameDetails.dodgersScore === 'number' &&
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
