import React from 'react'
import PropTypes from 'prop-types'
import { Card } from './Card'
import { Button } from './Button'
import { useServices } from '../hooks'
import { militaryFormat } from '../../../shared/datetime'

/**
 * Input element for editing a project title.
 */
const Title = props => {
  const [value, setValue] = React.useState(props.value)
  const handleChange = ({ target }) => setValue(target.value)
  const handleBlur = () => props.onChange(value)
  const handleKeyDown = event => event.stopPropagation()

  return <input
    className='card-title'
    value={value}
    onChange={handleChange}
    onBlur={handleBlur}
    onKeyDown={handleKeyDown}
  />
}

Title.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired
}

/**
 * Renders a preview image for a project.
 */
const Media = props => {
  const { loadPreview } = props
  const scale = 0.5
  const width = `${320 * scale}px`
  const height = `${240 * scale}px`
  const [source, setSource] = React.useState(undefined)

  React.useEffect(() => {
    (async () => {
      const src = await loadPreview()
      setSource(src)
    })()
  }, [loadPreview])

  const placeholder = (text = null) => (
    <div className='placeholder' style={{ width, height }}>
      { text }
    </div>
  )

  return source === undefined
    ? placeholder()
    : source === null
      ? placeholder('Preview not available')
      : <img src={source} width={width} height={height}/>
}

Media.propTypes = {
  loadPreview: PropTypes.func.isRequired
}

/**
 * Styled button used within list items.
 */
const CustomButton = props => (
  <Button
    danger={props.danger}
    onClick={props.onClick}
    disabled={props.disabled}
    style={{ ...props.style, background: 'inherit' }}
  >
    {props.text}
  </Button>
)

CustomButton.propTypes = {
  danger: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  style: PropTypes.object,
  text: PropTypes.string.isRequired,
  disabled: PropTypes.bool
}

/**
 * Button container.
 */
const ButtonBar = props => (
  <div style={{
    display: 'flex',
    marginTop: 'auto',
    gap: '8px'
  }}>
    {props.children}
  </div>
)

ButtonBar.propTypes = {
  children: PropTypes.array.isRequired
}

/**
 * Project list item displaying a single project entry.
 */
export const ProjectListItem = React.forwardRef((props, ref) => {
  const {
    project,
    id,
    selected,
    dispatch,
    replication,
    offline,
    fetchProjects,
    setManagedProject
  } = props
  const { projectStore, ipcRenderer } = useServices()
  const [linkLost, setLinkLost] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const credentials = await projectStore.getCredentials(project.id)
        const url = credentials?.home_server_url
        if (!url) {
          if (!cancelled) setLinkLost(false)
          return
        }
        const origin = new URL(url).origin
        const response = await globalThis.fetch(`${origin}/.well-known/matrix/client`)
        if (!response.ok) throw new Error('failed')
        if (!cancelled) setLinkLost(false)
      } catch (error) {
        if (!cancelled) setLinkLost(true)
      }
    })()
    return () => { cancelled = true }
  }, [project.id, projectStore])

  const send = message => () => ipcRenderer.send(message, project.id)
  const loadPreview = () => projectStore.getPreview(project.id)
  const handleRename = name => projectStore.updateProject({ ...project, name })
  const handleDelete = () => projectStore.deleteProject(project.id)
  const handleClick = pid => ({ metaKey, shiftKey }) => dispatch({ type: 'click', id: pid, shiftKey, metaKey })
  const handleJoin = async () => {
    const seed = await replication.join(project.id)
    await projectStore.createProject(project.id.split(':')[1], project.name, ['SHARED'])
    await projectStore.putReplicationSeed(project.id, seed)
  }
  const handleShare = async () => {
    const seed = await replication.share(project.id, project.name, project.description || '')
    await projectStore.addTag(project.id, 'SHARED')
    await projectStore.putReplicationSeed(project.id, seed)
    fetchProjects(project.id)
  }
  const handleResetCollab = async () => {
    await ipcRenderer.invoke('PURGE_PROJECT_COLLAB_SETTINGS', project.id)
    setLinkLost(false)
  }

  const isOpen = project.tags ? project.tags.includes('OPEN') : false
  const isInvited = project.tags ? project.tags.includes('INVITED') : false
  const isShared = project.tags ? project.tags.includes('SHARED') : false

  return (
    <div
      key={id}
      ref={ref}
      style={{ padding: '3px 6px' }}
    >
      <Card
        onClick={handleClick(id)}
        selected={selected}
        id={id}
      >
        <div style={{ display: 'flex', flexDirection: 'row' }}>
          <div className='card-content'>
            <Title value={project.name} onChange={handleRename}/>
            <span className='card-text'>{militaryFormat.fromISO(project.lastAccess)}</span>
            { linkLost && <span className='card-text' style={{ color: '#ff4d4f' }}>Server unreachable</span> }
            <ButtonBar>
              <CustomButton onClick={send('OPEN_PROJECT')} text='Open' disabled={isInvited && !isShared || linkLost}/>
              <CustomButton onClick={send('EXPORT_PROJECT')} text='Export' disabled={true}/>
              { (replication && isInvited) && <CustomButton onClick={handleJoin} text='Join' disabled={offline}/> }
              { (replication && !isInvited && !isShared && !isOpen) && <CustomButton onClick={handleShare} text='Share' disabled={offline}/> }
              { (replication && isShared) &&
                  <CustomButton
                    text='Members'
                    onClick={() => setManagedProject(project)}
                  />
              }
              { linkLost &&
                <CustomButton
                  onClick={handleResetCollab}
                  text='Reset collaboration settings'
                />
              }
              <CustomButton
                danger
                onClick={handleDelete}
                style={{ marginLeft: 'auto' }}
                text='Delete'
                disabled={isOpen}
              />
            </ButtonBar>
          </div>
          <Media loadPreview={loadPreview}/>
        </div>
      </Card>
    </div>
  )
})

ProjectListItem.propTypes = {
  project: PropTypes.object.isRequired,
  id: PropTypes.string.isRequired,
  selected: PropTypes.bool,
  dispatch: PropTypes.func.isRequired,
  replication: PropTypes.object,
  offline: PropTypes.bool.isRequired,
  fetchProjects: PropTypes.func.isRequired,
  setManagedProject: PropTypes.func.isRequired
}
