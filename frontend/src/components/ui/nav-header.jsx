import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

function NavHeader({ items, className }) {
  const navRef = useRef(null)
  const [activeKey, setActiveKey] = useState(null)
  const [openMenu, setOpenMenu] = useState(null)
  const [position, setPosition] = useState({
    left: 0,
    width: 0,
    opacity: 0,
  })

  useEffect(() => {
    const handleClick = (event) => {
      if (!navRef.current?.contains(event.target)) {
        setOpenMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleLeave = () => {
    if (openMenu) return
    setActiveKey(null)
    setPosition((pv) => ({ ...pv, opacity: 0 }))
  }

  return (
    <nav ref={navRef} className={cn('relative', className)} aria-label="Primary navigation">
      <ul
        className="relative mx-auto flex w-fit rounded-full bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
        onMouseLeave={handleLeave}
      >
        {items.map((item) => (
          <Tab
            key={item.key ?? item.label}
            item={item}
            active={activeKey === (item.key ?? item.label)}
            open={openMenu === (item.key ?? item.label)}
            setActiveKey={setActiveKey}
            setOpenMenu={setOpenMenu}
            setPosition={setPosition}
          />
        ))}
        <Cursor position={position} />
      </ul>

      {items
        .filter((item) => item.menu?.options?.length && openMenu === (item.key ?? item.label))
        .map((item) => (
          <div
            key={`${item.key ?? item.label}-menu`}
            className="absolute right-0 top-[calc(100%+0.625rem)] z-50 grid min-w-44 gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
            role="menu"
          >
            {item.menu.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  option.onSelect?.()
                  setOpenMenu(null)
                }}
                className={cn(
                  'w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-50 hover:text-sky-700',
                  option.selected && 'bg-sky-50 text-sky-700'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ))}
    </nav>
  )
}

function Tab({ item, active, open, setActiveKey, setOpenMenu, setPosition }) {
  const ref = useRef(null)
  const itemKey = item.key ?? item.label

  const updatePosition = () => {
    if (!ref.current) return

    const { width } = ref.current.getBoundingClientRect()
    setActiveKey(itemKey)
    setPosition({
      width,
      opacity: 1,
      left: ref.current.offsetLeft,
    })
  }

  const className = cn(
    'relative z-10 block cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors md:px-5 md:py-3 md:text-sm',
    (active || open) && 'text-white'
  )

  return (
    <li ref={ref} onMouseEnter={updatePosition} onFocus={updatePosition}>
      {item.to ? (
        <Link to={item.to} className={className}>
          {item.label}
        </Link>
      ) : item.menu ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            updatePosition()
            setOpenMenu(open ? null : itemKey)
          }}
          className={cn(className, 'bg-transparent')}
        >
          {item.label}
        </button>
      ) : (
        <button
          type="button"
          onClick={item.onClick}
          className={cn(className, 'bg-transparent')}
        >
          {item.label}
        </button>
      )}
    </li>
  )
}

function Cursor({ position }) {
  return (
    <motion.li
      animate={position}
      className="absolute z-0 h-7 rounded-full bg-sky-400 md:h-11"
    />
  )
}

export default NavHeader
