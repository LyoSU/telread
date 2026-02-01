import { type Component } from 'solid-js'

interface FolderChipProps {
    id: number | null
    title: string
    emoticon?: string
    count?: number
    active: boolean
    onClick: () => void
}

/**
 * Folder chip component for folder selection UI
 *
 * Displays a folder with its icon, title, and optional count.
 * Supports active state with visual feedback.
 *
 * Styles are defined in src/styles/index.css under "FOLDER CHIPS" section.
 */
export const FolderChip: Component<FolderChipProps> = (props) => {
    return (
        <button
            type="button"
            class="folder-chip"
            classList={{
                'folder-chip--active': props.active,
            }}
            onClick={props.onClick}
        >
            <span class="folder-chip__content">
                {props.emoticon && (
                    <span class="folder-chip__icon">{props.emoticon}</span>
                )}
                <span class="folder-chip__title">{props.title}</span>
                {props.count !== undefined && props.count > 0 && (
                    <span class="folder-chip__count">{props.count}</span>
                )}
            </span>
        </button>
    )
}
