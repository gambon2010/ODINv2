import React from 'react'
import { Button } from './Button'
import { FilterInput } from './FilterInput'
import { List } from './List'
import { useList, useServices } from '../hooks'
import MemberManagement from './MemberManagement'
import { ProjectListItem } from './ProjectListItem'

export const ProjectList = () => {

  const { projectStore, ipcRenderer, replicationProvider } = useServices()
  const [filter, setFilter] = React.useState('')
  const [state, dispatch] = useList({ multiselect: false })

  const [replication, setReplication] = React.useState(undefined)
  const [managedProject, setManagedProject] = React.useState(null)

  /* system/OS level notifications */
  const notifications = React.useRef(new Set())
  const [offline, setOffline] = React.useState(false)
  const [initialized, setInitialized] = React.useState(false)
  const [message, setMessage] = React.useState(null)

  const abortController = React.useRef(new AbortController())

  const feedback = message => setMessage(message)

  /**
   * Reload projects from store and update entry list
   * with optional entry id to focus.
   * Use current filter to load only projects to display in list.
   *
   * @param {*} projectId - optional project id to focus in list next.
   * @param {*} ephemeralProject - An array of projects we received an invitation for, defaults to []
   */
  const fetch = React.useCallback((projectId, ephemeralProjects = []) => {
    (async () => {
      const projects = await projectStore.getProjects(filter)
      const localProjectIds = projects.map(p => p.id)
      const sharedProjects = replication ? (await replication.invited()) : []

      /*  Sometimes the replication API does not update the state immediately. In order to
          avoid duplicate entries - one from the local db and one from the replication API -
          we remove these duplicate entries.
      */
      const invitedProjects = [...sharedProjects, ...ephemeralProjects]
        .filter(project => !localProjectIds.includes(project.id))
        .map(project => ({ ...project, ...{ tags: ['INVITED'] } }))

      const allProjects = [...projects, ...invitedProjects]
      dispatch({ type: 'entries', entries: allProjects, candidateId: projectId })
      if (projectId) dispatch({ type: 'select', id: projectId })
    })()
  }, [dispatch, filter, projectStore, replication])


  /**
   * Listen to store events.
   * Reload/updates projects as appropriate.
   */
  React.useEffect(() => {
    const updated = async ({ project }) => fetch(project.id)
    const created = async ({ project }) => fetch(project.id)
    const deleted = async () => fetch()

    const handlers = { updated, created, deleted }
    Object.entries(handlers).forEach(([event, handler]) => projectStore.on(event, handler))

    return () => {
      Object.entries(handlers).forEach(([event, handler]) => projectStore.off(event, handler))
    }
  }, [projectStore, fetch])


  /**
   * Listen on project/window close event.
   * Updates projects as appropriate.
   */
  React.useEffect(() => {
    const channel = 'ipc:post:project/closed'
    const handleClosed = () => fetch()
    ipcRenderer.on(channel, handleClosed)
    return () => ipcRenderer.off(channel, handleClosed)
  }, [ipcRenderer, fetch])


  /**
   * Reload projects whenever search filter changes.
   */
  React.useEffect(fetch, [fetch])

  React.useEffect(() => {
    if (!initialized) return

    const reconnect = async () => {
      try {
        abortController.current = new AbortController()
        await replicationProvider.connect(abortController.current)
        setOffline(false)
        feedback(null)
      } catch (error) {
        // issued by abortController
        if (error === 'online') {
          setOffline(false)
          feedback(null)
          return
        }
        console.error(error)
        feedback(error.message)
        setOffline(true)
      }
    }
    reconnect()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, offline])

  React.useEffect(() => {
    const initializeReplication = async () => {
      try {
        feedback('Initializing replication ...')

        /*
          Replication credentials are tokens that are used to authenticate the current SESSION
          to the replication server. Credentials do not contain the user's password.
        */
        const credentials = await projectStore.getCredentials('PROJECT-LIST')
        const replicatedProjectList = await replicationProvider.projectList(credentials)

        if (!credentials) {
          const currentCredentials = replicatedProjectList.credentials()
          await projectStore.putCredentials('PROJECT-LIST', currentCredentials)
        }

        replicatedProjectList.tokenRefreshed(credentials => {
          projectStore.putCredentials('PROJECT-LIST', credentials)
        })

        /*
          connect() waits endlessly
        */
        await replicationProvider.connect()
        await replicatedProjectList.hydrate()

        const handler = {
          streamToken: streamToken => {
            projectStore.putStreamToken('PROJECT-LIST', streamToken)
            setOffline(false)
          },
          renamed: (/* project */) => {
            fetch()
          },
          invited: (project) => {
            const clickHandler = event => {
              event.preventDefault() // prevent the browser from focusing the Notification's tab
              event.target.onclick = undefined
              dispatch({ type: 'select', id: project.id })
              notifications.current.delete(event.target)
            }
            const closeHandler = event => {
              event.target.onclick = undefined
              notifications.current.delete(event.target)
            }

            const notification = new Notification('Received invitation', { body: project.name, data: project.id })
            notification.onclick = clickHandler
            notification.onclose = closeHandler
            notifications.current.add(notification)

            fetch(null, [project])
          },
          error: error => {
            console.error(error)
            feedback('Looks like we are offline! Reconnecting ...')
            setOffline(true)
          }
        }
        const mostRecentStreamToken = await projectStore.getStreamToken('PROJECT-LIST')
        replicatedProjectList.start(mostRecentStreamToken, handler)

        setReplication(replicatedProjectList)
        feedback(null)
        setInitialized(true)

        window.addEventListener('online', () => {
          console.log('Browser thinks we are back online. Let\'s give it a try ...')
          abortController.current.abort('online')
        })

      } catch (error) {

        console.error(error)
        setOffline(true)
        if (!navigator.onLine) {
          feedback('Looks like we are offline! Reconnecting ...')
        } else {
          feedback('Replication error: ', error.message)
          await projectStore.putCredentials('PROJECT-LIST', null)
          ipcRenderer.postMessage('COLLABORATION_REFRESH_LOGIN')
        }
      }
    }

    if (replicationProvider.disabled) {
      console.log('Replication is disabled')
      return
    }
    initializeReplication()

    /*
      Returning a cleanup function from this top-level component does not make sense. The window
      gets closed but react does not execute the cleanup function.
      Even subscribing to the appropriate window event (beforeunload) does not work in order to
      logout from the replication server.
    */


  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = event => {
    const { key, shiftKey, metaKey, ctrlKey } = event

    // Prevent native scroll:
    if (['ArrowDown', 'ArrowUp'].includes(key)) event.preventDefault()

    dispatch({ type: `keydown/${key}`, shiftKey, metaKey, ctrlKey })
  }

  const handleFilterChange = React.useCallback(value => setFilter(value), [])
  const handleCreate = () => projectStore.createProject()

  /* eslint-disable react/prop-types */
  const child = React.useCallback(props => (
    <ProjectListItem
      {...props}
      project={props.entry}
      dispatch={dispatch}
      replication={replication}
      offline={offline}
      fetchProjects={fetch}
      setManagedProject={setManagedProject}
    />
  ), [dispatch, replication, offline, fetch, setManagedProject])



  return (
    <div >
      { managedProject && <MemberManagement replication={replication} managedProject={managedProject} onClose={() => setManagedProject(null)}/>}
      <div
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh'
        }}
      >
        { (message) && <div style={{ display: 'flex', padding: '8px', justifyContent: 'center', backgroundColor: 'rgb(255,77,79)' }}>{message}</div> }
        <div
          style={{ display: 'flex', gap: '8px', padding: '8px' }}
        >
          <FilterInput onChange={handleFilterChange} placeholder='search for projects'/>
          <Button onClick={handleCreate}>New</Button>
          <Button disabled={true}>Import</Button>
        </div>
        <List child={child} { ...state }/>
      </div>
    </div>
  )
}

ProjectList.whyDidYouRender = true
