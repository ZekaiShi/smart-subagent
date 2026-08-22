// Browser half of the smart-subagent dsh plugin: the Evolution settings card.
//
// Renders a plugin card in Settings -> Plugins (the settings.plugin.item
// slot). The card groups every detected subagent by project workspace, shows
// each agent's current routing provider/model, lets you switch the model with a
// dropdown (writes the binding .md front matter), edits each agent's hidden
// prefercmd.md / memory.md evolution files, and flips the evolution toggle.
//
// Hand-written in the lazy-CJS bundle protocol
// (window.__ModuleLoader__.load with a factory returning cordis-plugin
// exports), so no build step and no dsh client imports — the same
// zero-dependency stance as the modlens card it was modelled on.
window.__ModuleLoader__.load({
  id: 'smart-subagent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var EN = {
      title: 'smart-subagent',
      subtitle: 'Evolution mode · subagents grouped by project · model dropdown',
      scope: 'Scope',
      scopeBindings: 'Bindings',
      scopeEvolution: 'Evolution',
      scopeProjects: 'Projects scan',
      projects: 'Subagents by project',
      projectsHint: 'each project owns its agents/ + evolution',
      model: 'Routing model',
      modelFixed: 'built-in template (read-only)',
      source: { binding: 'binding', template: 'built-in', both: 'binding + built-in' },
      toggle: 'Evolution mode',
      toggleHint: 'Inject learned commands & lessons into foreground runs',
      prefercmd: 'prefercmd.md — verified commands',
      memory: 'memory.md — lessons learned',
      save: 'Save',
      saved: 'Saved',
      saving: 'Saving…',
      discard: 'Discard',
      loadFailed: 'Load failed',
      saveFailed: 'Save failed',
      toggleFailed: 'Toggle failed',
      modelFailed: 'Model update failed',
      loading: 'Loading…',
      empty: 'No projects with an agents/ folder found',
      scanHint: 'Point SMART_SUBAGENT_PROJECTS_DIR at the workspace root that contains your projects to detect them here.',
      open: 'Open',
    }
    var ZH = {
      title: 'smart-subagent',
      subtitle: '进化模式 · 按项目分组的 subagents · 模型下拉',
      scope: '作用域',
      scopeBindings: '绑定目录',
      scopeEvolution: '进化目录',
      scopeProjects: '项目扫描目录',
      projects: '按项目分组的 subagents',
      projectsHint: '每个项目独立拥有 agents/ 与进化文件',
      model: '路由模型',
      modelFixed: '内置模板（只读）',
      source: { binding: '绑定', template: '内置', both: '绑定 + 内置' },
      toggle: '进化模式',
      toggleHint: '把学到的命令与经验注入前台运行的子代理',
      prefercmd: 'prefercmd.md — 已验证命令',
      memory: 'memory.md — 经验教训',
      save: '保存',
      saved: '已保存',
      saving: '保存中…',
      discard: '放弃修改',
      loadFailed: '加载失败',
      saveFailed: '保存失败',
      toggleFailed: '切换失败',
      modelFailed: '模型更新失败',
      loading: '加载中…',
      empty: '未找到含 agents/ 文件夹的项目',
      scanHint: '把 SMART_SUBAGENT_PROJECTS_DIR 指向包含你项目的工作区根目录，即可在这里检测到项目。',
      open: '展开',
    }

    function noteFrom(error, fallback) {
      var text = error && error.message ? error.message : ''
      return text ? fallback + ': ' + text : fallback
    }

    function CardFactory(react, localeRef) {
      var h = react.createElement

      var subscribeLocale = (onChange) => {
        var locale = localeRef && localeRef.current
        return locale ? locale.subscribe(onChange) : () => {}
      }
      var readLocale = () => {
        var locale = localeRef && localeRef.current
        return locale ? locale.getSnapshot().active : ''
      }
      var useLocale = () =>
        typeof react.useSyncExternalStore === 'function'
          ? react.useSyncExternalStore(subscribeLocale, readLocale)
          : readLocale()

      var chevron = (open) =>
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            style: {
              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
              flex: 'none',
              transition: 'transform .16s',
              transform: open ? 'rotate(180deg)' : 'none',
            },
          },
          h('path', {
            d: 'M4 6l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )

      var fieldRow = (label, control, key) =>
        h(
          'label',
          {
            key: key,
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '12px 0',
              borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
            },
          },
          h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, inherit)' } }, label),
          control,
        )

      var editorStyles = {
        width: '100%',
        minHeight: '96px',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        resize: 'vertical',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }

      var selectStyles = {
        font: 'inherit',
        fontSize: '12px',
        padding: '4px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        maxWidth: '240px',
      }

      return function SmartSubagentCard() {
        var t = useLocale() === 'zh' ? ZH : EN
        var openState = react.useState(false)
        var summaryState = react.useState(null)
        var noteState = react.useState('')
        var editorsState = react.useState({})
        var open = openState[0]
        var summary = summaryState[0]
        var note = noteState[0]
        var editors = editorsState[0]
        var setEditors = editorsState[1]

        var load = react.useCallback(() => {
          fetch('/smart-subagent/projects')
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then((next) => {
              summaryState[1](next)
              noteState[1]('')
            })
            .catch((error) => noteState[1](noteFrom(error, t.loadFailed)))
        }, [t.loadFailed])

        react.useEffect(() => {
          if (open && summary === null) load()
        }, [open, summary, load])

        var toggle = (value) => {
          var next = { ...(summary || {}), evolution: value }
          summaryState[1](next)
          fetch('/smart-subagent/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ evolution: value }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then((body) => summaryState[1]({ ...next, evolution: body.evolution }))
            .catch(() => noteState[1](t.toggleFailed))
        }

        var changeModel = (projectRoot, agentKey, model) => {
          fetch('/smart-subagent/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, agentKey, model }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then(() => load())
            .catch((error) => noteState[1](noteFrom(error, t.modelFailed)))
        }

        var readFiles = (projectRoot, agentKey) => {
          var id = projectRoot + '::' + agentKey
          var set = setEditors
          set((prev) => ({ ...prev, [id]: { ...prev[id], loading: true } }))
          fetch('/smart-subagent/evolution/read', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, agentKey }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then((body) => {
              set((prev) => ({
                ...prev,
                [id]: {
                  ...prev[id],
                  loading: false,
                  open: true,
                  dirty: false,
                  prefercmd: body.prefercmd || '',
                  memory: body.memory || '',
                  note: '',
                },
              }))
            })
            .catch((error) => {
              set((prev) => ({
                ...prev,
                [id]: { ...prev[id], loading: false, note: noteFrom(error, t.loadFailed) },
              }))
            })
        }

        var saveFiles = (projectRoot, agentKey) => {
          var id = projectRoot + '::' + agentKey
          var entry = editors[id]
          if (!entry) return
          setEditors((prev) => ({ ...prev, [id]: { ...prev[id], note: t.saving } }))
          fetch('/smart-subagent/evolution/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, agentKey, prefercmd: entry.prefercmd, memory: entry.memory }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then(() => {
              setEditors((prev) => ({
                ...prev,
                [id]: { ...prev[id], dirty: false, note: t.saved },
              }))
            })
            .catch((error) => {
              setEditors((prev) => ({
                ...prev,
                [id]: { ...prev[id], note: noteFrom(error, t.saveFailed) },
              }))
            })
        }

        var discardFiles = (projectRoot, agentKey) => {
          var id = projectRoot + '::' + agentKey
          setEditors((prev) => ({
            ...prev,
            [id]: { ...prev[id], dirty: false, note: '' },
          }))
          readFiles(projectRoot, agentKey)
        }

        var setEditor = (id, patch) => {
          setEditors((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, dirty: true } }))
        }

        var body = null
        if (open) {
          if (summary === null) {
            body = h(
              'div',
              { style: { padding: '12px 0', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px' } },
              note || t.loading,
            )
          } else {
            var projects = Array.isArray(summary.projects) ? summary.projects : []
            var modelsByProvider = summary.modelsByProvider || {}
            var projectSections = projects.map((project) => {
              var projectRoot = project.projectRoot
              var agentRows = (project.agents || []).map((agent) => {
                var key = agent.agentKey
                var id = projectRoot + '::' + key
                var entry = editors[id] || {}
                var expanded = Boolean(entry.open)
                var options = modelsByProvider[agent.provider] || []
                var modelControl = agent.editable
                  ? h(
                      'select',
                      {
                        value: agent.model || '',
                        onChange: (event) => changeModel(projectRoot, key, event.target.value),
                        style: selectStyles,
                        'aria-label': t.model + ' · ' + key,
                      },
                      options.length === 0
                        ? h('option', { key: agent.model || '' }, agent.model || '')
                        : options.map((model) => h('option', { key: model, value: model }, model)),
                    )
                  : h(
                      'span',
                      {
                        style: {
                          fontSize: '12px',
                          padding: '4px 8px',
                          borderRadius: '8px',
                          border: '1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                          color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        },
                      },
                      (agent.model || '') + ' · ' + t.modelFixed,
                    )
                return h(
                  'div',
                  { key: key },
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 4px',
                      },
                    },
                    h(
                      'button',
                      {
                        type: 'button',
                        'aria-expanded': expanded,
                        onClick: () => (entry.open ? setEditors((p) => ({ ...p, [id]: { ...p[id], open: false } })) : readFiles(projectRoot, key)),
                        style: {
                          appearance: 'none',
                          font: 'inherit',
                          color: 'inherit',
                          textAlign: 'left',
                          cursor: 'pointer',
                          background: 'none',
                          border: 0,
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '0',
                        },
                      },
                      h('span', { style: { fontSize: '13px', fontWeight: 500 } }, key),
                      h(
                        'span',
                        {
                          style: {
                            fontSize: '11px',
                            padding: '1px 8px',
                            borderRadius: '999px',
                            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          },
                        },
                        (t.source[agent.source] || agent.source),
                      ),
                      h('span', { style: { marginLeft: 'auto', flex: 'none' } }, chevron(expanded)),
                    ),
                    h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '0 4px 4px',
                        },
                      },
                      h(
                        'span',
                        { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                        t.model,
                      ),
                      modelControl,
                    ),
                  ),
                  expanded
                    ? h(
                        'div',
                        { style: { padding: '4px 4px 8px', display: 'flex', flexDirection: 'column', gap: '8px' } },
                        entry.loading
                          ? h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } }, t.loading)
                          : h(
                              'div',
                              null,
                              fieldRow(
                                t.prefercmd,
                                h('textarea', {
                                  value: entry.prefercmd || '',
                                  spellCheck: false,
                                  style: editorStyles,
                                  onChange: (event) => setEditor(id, { prefercmd: event.target.value }),
                                }),
                                id + '-pc',
                              ),
                              fieldRow(
                                t.memory,
                                h('textarea', {
                                  value: entry.memory || '',
                                  spellCheck: false,
                                  style: editorStyles,
                                  onChange: (event) => setEditor(id, { memory: event.target.value }),
                                }),
                                id + '-mem',
                              ),
                              h(
                                'div',
                                {
                                  style: {
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '8px 0 4px',
                                  },
                                },
                                h(
                                  'span',
                                  {
                                    role: 'status',
                                    style: {
                                      marginRight: 'auto',
                                      fontSize: '12px',
                                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                                    },
                                  },
                                  entry.note || '',
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    disabled: !entry.dirty,
                                    onClick: () => discardFiles(projectRoot, key),
                                    style: {
                                      appearance: 'none',
                                      font: 'inherit',
                                      fontSize: '13px',
                                      lineHeight: 1.5,
                                      cursor: entry.dirty ? 'pointer' : 'default',
                                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                                      borderRadius: '8px',
                                      padding: '5px 14px',
                                      background: 'none',
                                      color: 'var(--dsw-alias-label-secondary, inherit)',
                                      opacity: entry.dirty ? 1 : 0.4,
                                    },
                                  },
                                  t.discard,
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    disabled: !entry.dirty,
                                    onClick: () => saveFiles(projectRoot, key),
                                    style: {
                                      appearance: 'none',
                                      font: 'inherit',
                                      fontSize: '13px',
                                      lineHeight: 1.5,
                                      cursor: entry.dirty ? 'pointer' : 'default',
                                      border: '1px solid transparent',
                                      borderRadius: '8px',
                                      padding: '5px 14px',
                                      background: 'var(--dsw-alias-label-primary, currentColor)',
                                      color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                                      opacity: entry.dirty ? 1 : 0.4,
                                    },
                                  },
                                  t.save,
                                ),
                              ),
                            ),
                    )
                    : null,
                )
              })

              return h(
                'div',
                { key: projectRoot },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '10px 0 4px',
                    },
                  },
                  h('div', { style: { fontSize: '13px', fontWeight: 600 } }, project.projectName || projectRoot),
                  h(
                    'div',
                    { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                    project.projectRoot || '',
                  ),
                ),
                agentRows.length === 0
                  ? h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', padding: '4px 0' } }, t.empty)
                  : h('div', null, agentRows),
              )
            })

            body = h(
              'div',
              null,
              summary.scope
                ? h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        fontSize: '12px',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                      h('span', { style: { fontWeight: 600 } }, t.scope),
                      h(
                        'span',
                        {
                          style: {
                            padding: '1px 8px',
                            borderRadius: '999px',
                            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          },
                        },
                        summary.scope.projectName || '',
                      ),
                    ),
                    h('div', { style: { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                      t.scopeProjects + ': ' + (summary.scope.projectsBaseDir || '')),
                  )
                : null,
              h(
                'label',
                {
                  style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', fontSize: '13px' },
                },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(summary.evolution),
                  onChange: (event) => toggle(event.target.checked),
                }),
                h('span', { style: { fontWeight: 500 } }, t.toggle),
                h('span', { style: { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '12px' } }, t.toggleHint),
              ),
              fieldRow(
                h(
                  'span',
                  null,
                  t.projects,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        fontWeight: 400,
                        marginLeft: '8px',
                        fontSize: '12px',
                      },
                    },
                    t.projectsHint,
                  ),
                ),
                projects.length === 0
                  ? h(
                      'div',
                      { style: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', display: 'flex', flexDirection: 'column', gap: '4px' } },
                      h('span', null, t.empty),
                      h('span', { style: { fontSize: '12px' } }, t.scanHint),
                    )
                  : h('div', null, projectSections),
                'projects',
              ),
            )
          }
        }

        return h(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              background: open
                ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))'
                : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
              borderRadius: '12px',
              transition: 'border-color .16s, background .16s',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: () => {
                openState[1](!open)
              },
              style: {
                appearance: 'none',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'none',
                border: 0,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t.title),
              h(
                'div',
                { style: { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px', lineHeight: 1.5 } },
                t.subtitle,
              ),
            ),
            chevron(open),
          ),
          open ? h('div', { style: { margin: '0 16px', paddingBottom: '8px' } }, body) : null,
        )
      }
    }

    function registerCard(ctx) {
      if (typeof ctx.inject !== 'function') return
      var localeRef = { current: null }
      ctx.inject(['locale'], (scope) => {
        localeRef.current = scope.locale
        if (typeof scope.effect === 'function') {
          scope.effect(() => () => { localeRef.current = null }, 'smart-subagent: locale handle')
        }
      })
      ctx.inject(['slots'], (scope) => {
        // The card and its host routes live and die together: any response
        // proves the route exists; only a 404 means no web profile.
        fetch('/smart-subagent/projects')
          .then((response) => {
            if (response.status === 404) return
            try {
              mountCard(scope, localeRef)
            } catch (error) {
              console.error(`[smart-subagent] settings card skipped: ${error}`)
            }
          })
          .catch(() => {})
      })
    }

    function mountCard(ctx, localeRef) {
      var react
      try {
        react = require('react')
      } catch (error) {
        console.error(`[smart-subagent] settings card skipped: ${error}`)
        return
      }
      var Card = CardFactory(react, localeRef)
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({ name: 'settings.plugin.item', id: 'smart-subagent', key: 'smart-subagent', order: 31 }, Card)
      })
    }

    function apply(ctx) {
      registerCard(ctx)
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
