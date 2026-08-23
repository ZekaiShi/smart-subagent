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
      subtitle: 'Evolution mode · subagents grouped by workspace · model dropdown',
      scope: 'Scope',
      scopeBindings: 'Bindings',
      scopeEvolution: 'Evolution',
      scopeProjects: 'Scan source',
      scanAuto: 'workspaces (auto)',
      scanManual: 'custom dir',
      scanNone: 'not configured',
      scanFallback: 'Fallback scan dir - used only when no workspaces are registered; empty clears it',
      scanSave: 'Save',
      builtin: 'Built-in templates',
      builtinHint: 'official roles, always available',
      addTo: 'Add to',
      addTemplate: 'Add built-in template',
      added: 'Added',
      addFailed: 'Add failed',
      noWorkspace: 'No target workspace',
      mainAgent: 'Main agent',
      mainAgentHint: 'workspace-root AGENTS.md',
      mainAgentUnbound: 'Not bound',
      mainAgentMissing: 'AGENTS.md not found',
      mainAgentFailed: 'Main agent update failed',
      projects: 'Subagents by project',
      projectsHint: 'each project owns its agents/ + evolution',
      provider: 'Provider',
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
      configFailed: 'Config update failed',
      loading: 'Loading…',
      empty: 'No projects with an agents/ folder found',
      scanHint: 'No workspaces are registered in this profile yet. Open a conversation in a project folder, or set a fallback dir above.',
      open: 'Open',
    }
    var ZH = {
      title: 'smart-subagent',
      subtitle: '进化模式 · 按工作区分组的 subagents · 模型下拉',
      scope: '作用域',
      scopeBindings: '绑定目录',
      scopeEvolution: '进化目录',
      scopeProjects: '扫描来源',
      scanAuto: '工作区自动扫描',
      scanManual: '自定义目录',
      scanNone: '未配置',
      scanFallback: '备用扫描目录 - 仅在未注册工作区时使用，留空可清除',
      scanSave: '保存',
      builtin: '内置模板',
      builtinHint: '官方角色，始终可用',
      addTo: '添加到',
      addTemplate: '添加内置模板',
      added: '已添加',
      addFailed: '添加失败',
      noWorkspace: '无目标工作区',
      mainAgent: 'Main agent',
      mainAgentHint: '工作区根目录 AGENTS.md',
      mainAgentUnbound: '未绑定',
      mainAgentMissing: '未检测到 AGENTS.md',
      mainAgentFailed: '主 Agent 更新失败',
      projects: '按项目分组的 subagents',
      projectsHint: '每个项目独立拥有 agents/ 与进化文件',
      provider: 'Provider',
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
      configFailed: '配置更新失败',
      loading: '加载中…',
      empty: '未发现含 agents/ 文件夹的项目',
      scanHint: '此 profile 尚未注册任何工作区。在项目文件夹里打开一个对话，或在上方填写备用目录。',
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
        height: '28px',
        boxSizing: 'border-box',
        padding: '3px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        minWidth: 0,
      }

      return function SmartSubagentCard() {
        var t = useLocale() === 'zh' ? ZH : EN
        var openState = react.useState(false)
        var summaryState = react.useState(null)
        var noteState = react.useState('')
        var editorsState = react.useState({})
        var scanDirState = react.useState('')
        var routesState = react.useState({})
        var groupsState = react.useState({ builtin: true })
        var targetWorkspaceState = react.useState('')
        var open = openState[0]
        var summary = summaryState[0]
        var note = noteState[0]
        var editors = editorsState[0]
        var setEditors = editorsState[1]
        var scanDir = scanDirState[0]
        var setScanDir = scanDirState[1]
        var routes = routesState[0]
        var setRoutes = routesState[1]
        var groups = groupsState[0]
        var setGroups = groupsState[1]
        var targetWorkspace = targetWorkspaceState[0]
        var setTargetWorkspace = targetWorkspaceState[1]

        var load = react.useCallback(() => {
          fetch('/smart-subagent/projects')
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then((next) => {
              summaryState[1](next)
              setScanDir((next.scope && next.scope.projectsBaseDir) || '')
              var registered = next.scope && Array.isArray(next.scope.workspaces) ? next.scope.workspaces : []
              var targets = registered.length > 0
                ? registered
                : (next.projects || []).map((project) => ({ path: project.projectRoot, title: project.projectName }))
              if (targets.length === 0 && next.scope && next.scope.projectsBaseDir) {
                targets = [{ path: next.scope.projectsBaseDir, title: next.scope.projectsBaseDir }]
              }
              setTargetWorkspace((current) => targets.some((item) => item.path === current) ? current : ((targets[0] && targets[0].path) || ''))
              noteState[1]('')
            })
            .catch((error) => noteState[1](noteFrom(error, t.loadFailed)))
        }, [t.loadFailed])

        react.useEffect(() => {
          if (open && summary === null) load()
        }, [open, summary, load])

        var saveScanDir = () => {
          // Empty string clears the fallback dir on the host, returning the
          // card to pure workspace auto-detection.
          var value = scanDir.trim()
          noteState[1](t.saving)
          fetch('/smart-subagent/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectsBaseDir: value }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then((body) => {
              summaryState[1]((prev) => ({ ...(prev || {}), scope: { ...((prev && prev.scope) || {}), projectsBaseDir: body.projectsBaseDir } }))
              noteState[1]('')
              load()
            })
            .catch((error) => noteState[1](noteFrom(error, t.configFailed)))
        }

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

        // POST a provider/model route change and keep a local draft of the
        // selection so the two dropdowns stay consistent while saving.
        var postModel = (projectRoot, agentKey, provider, model) => {
          fetch('/smart-subagent/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, agentKey, provider, model }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then(() => load())
            .catch((error) => noteState[1](noteFrom(error, t.modelFailed)))
        }

        var changeModel = (projectRoot, agentKey, provider, model) => {
          var id = projectRoot + '::' + agentKey
          setRoutes((prev) => ({ ...prev, [id]: { provider, model } }))
          postModel(projectRoot, agentKey, provider, model)
        }

        var changeProvider = (projectRoot, agentKey, provider, modelsByProvider) => {
          var id = projectRoot + '::' + agentKey
          // Auto-pick the first model of the newly selected provider so one
          // provider click is a complete, routable selection.
          var models = modelsByProvider[provider] || []
          var model = models[0] || ''
          setRoutes((prev) => ({ ...prev, [id]: { provider, model } }))
          if (model.length > 0) postModel(projectRoot, agentKey, provider, model)
        }

        var addTemplate = (projectRoot, agentKey) => {
          if (!projectRoot) return
          noteState[1](t.saving)
          fetch('/smart-subagent/template/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, agentKey }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then(() => load())
            .catch((error) => noteState[1](noteFrom(error, t.addFailed)))
        }

        var setMainAgent = (projectRoot, filename) => {
          noteState[1](t.saving)
          fetch('/smart-subagent/main-agent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectRoot, filename }),
          })
            .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || '')))))
            .then(() => load())
            .catch((error) => noteState[1](noteFrom(error, t.mainAgentFailed)))
        }

        var readFiles = (projectRoot, agentKey, editorId) => {
          var id = editorId || (projectRoot + '::' + agentKey)
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

        var saveFiles = (projectRoot, agentKey, editorId) => {
          var id = editorId || (projectRoot + '::' + agentKey)
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

        var discardFiles = (projectRoot, agentKey, editorId) => {
          var id = editorId || (projectRoot + '::' + agentKey)
          setEditors((prev) => ({
            ...prev,
            [id]: { ...prev[id], dirty: false, note: '' },
          }))
          readFiles(projectRoot, agentKey, id)
        }

        var setEditor = (id, patch) => {
          setEditors((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, dirty: true } }))
        }

        var evolutionEditor = (projectRoot, agentKey, id, entry) =>
          h(
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
                    { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '8px 0 4px' } },
                    h(
                      'span',
                      { role: 'status', style: { marginRight: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                      entry.note || '',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        disabled: !entry.dirty,
                        onClick: () => discardFiles(projectRoot, agentKey, id),
                        style: {
                          appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5,
                          cursor: entry.dirty ? 'pointer' : 'default',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                          borderRadius: '8px', padding: '5px 14px', background: 'none',
                          color: 'var(--dsw-alias-label-secondary, inherit)', opacity: entry.dirty ? 1 : 0.4,
                        },
                      },
                      t.discard,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        disabled: !entry.dirty,
                        onClick: () => saveFiles(projectRoot, agentKey, id),
                        style: {
                          appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5,
                          cursor: entry.dirty ? 'pointer' : 'default', border: '1px solid transparent',
                          borderRadius: '8px', padding: '5px 14px',
                          background: 'var(--dsw-alias-label-primary, currentColor)',
                          color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))', opacity: entry.dirty ? 1 : 0.4,
                        },
                      },
                      t.save,
                    ),
                  ),
                ),
          )

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
            var builtin = Array.isArray(summary.builtin) ? summary.builtin : []
            var modelsByProvider = summary.modelsByProvider || {}
            var scopeInfo = (summary && summary.scope) || {}
            var scanSource = scopeInfo.scanSource || (scopeInfo.projectsBaseDir ? 'manual' : 'none')
            var workspaces = Array.isArray(scopeInfo.workspaces) ? scopeInfo.workspaces : []
            var sourceText
            if (scanSource === 'workspaces') {
              sourceText =
                t.scanAuto +
                ' · ' +
                workspaces.length +
                '：' +
                workspaces.map((w) => w.title || w.path).join('、')
            } else if (scanSource === 'manual') {
              sourceText = t.scanManual + '：' + (scopeInfo.projectsBaseDir || '')
            } else {
              sourceText = t.scanNone
            }
            var addTargets = workspaces.length > 0
              ? workspaces
              : projects.map((project) => ({ path: project.projectRoot, title: project.projectName }))
            if (addTargets.length === 0 && scopeInfo.projectsBaseDir) {
              addTargets = [{ path: scopeInfo.projectsBaseDir, title: scopeInfo.projectsBaseDir }]
            }
            var selectedProject = projects.find((project) => project.projectRoot === targetWorkspace)
            var projectSections = projects.map((project) => {
              var projectRoot = project.projectRoot
              var agentRows = (project.agents || []).map((agent) => {
                var key = agent.agentKey
                var id = projectRoot + '::' + key
                var entry = editors[id] || {}
                var expanded = Boolean(entry.open)
                // Draft route selection: falls back to the agent's persisted
                // provider/model until the user picks something.
                var draft = routes[id] || {}
                var currentProvider = draft.provider || agent.provider || ''
                var currentModel = draft.model || agent.model || ''
                var providerOptions = Object.keys(modelsByProvider)
                var modelOptions = modelsByProvider[currentProvider] || []
                var modelControl = agent.editable
                  ? h(
                      'div',
                      {
                        style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none', whiteSpace: 'nowrap' },
                      },
                      h(
                        'select',
                        {
                          value: currentProvider,
                          onChange: (event) => changeProvider(projectRoot, key, event.target.value, modelsByProvider),
                          style: { ...selectStyles, width: '128px' },
                          'aria-label': t.provider + ' · ' + key,
                        },
                        providerOptions.length === 0
                          ? h('option', { key: currentProvider }, currentProvider)
                          : providerOptions.map((provider) => h('option', { key: provider, value: provider }, provider)),
                      ),
                      h(
                        'select',
                        {
                          value: currentModel,
                          onChange: (event) => changeModel(projectRoot, key, currentProvider, event.target.value),
                          style: { ...selectStyles, width: '184px' },
                          'aria-label': t.model + ' · ' + key,
                        },
                        modelOptions.length === 0
                          ? h('option', { key: currentModel }, currentModel)
                          : modelOptions.map((model) => h('option', { key: model, value: model }, model)),
                      ),
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
                          padding: '4px',
                          minWidth: 0,
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
                          flex: '1 1 auto',
                          minWidth: 0,
                          overflow: 'hidden',
                        },
                      },
                      h('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, key),
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
                      h('span', { style: { flex: 'none' } }, chevron(expanded)),
                    ),
                    modelControl,
                  ),
                  expanded ? evolutionEditor(projectRoot, key, id, entry) : null,
                )
              })

              var mainInfo = project.mainAgent || { filename: '', candidates: [] }
              var mainId = projectRoot + '::@main'
              var mainEntry = editors[mainId] || {}
              var mainBound = Boolean(mainInfo.filename)
              var mainExpanded = Boolean(mainEntry.open)
              var mainCandidates = Array.isArray(mainInfo.candidates) ? mainInfo.candidates : []
              var mainRow = h(
                'div',
                { key: '@main' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px', minWidth: 0 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: !mainBound,
                      'aria-expanded': mainExpanded,
                      onClick: () => (mainEntry.open
                        ? setEditors((prev) => ({ ...prev, [mainId]: { ...prev[mainId], open: false } }))
                        : readFiles(projectRoot, 'main', mainId)),
                      style: {
                        appearance: 'none', font: 'inherit', color: 'inherit', textAlign: 'left',
                        cursor: mainBound ? 'pointer' : 'default', background: 'none', border: 0,
                        borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px',
                        padding: 0, flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
                        opacity: mainBound ? 1 : 0.65,
                      },
                    },
                    h('span', { style: { fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' } }, t.mainAgent),
                    h(
                      'span',
                      {
                        style: {
                          fontSize: '11px', padding: '1px 8px', borderRadius: '999px',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                          color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', whiteSpace: 'nowrap',
                        },
                      },
                      t.mainAgentHint,
                    ),
                    mainBound ? h('span', { style: { flex: 'none' } }, chevron(mainExpanded)) : null,
                  ),
                  h(
                    'select',
                    {
                      value: mainInfo.filename || '',
                      disabled: mainCandidates.length === 0 && !mainBound,
                      onChange: (event) => setMainAgent(projectRoot, event.target.value),
                      style: { ...selectStyles, width: '184px', flex: 'none', opacity: mainCandidates.length === 0 && !mainBound ? 0.55 : 1 },
                      'aria-label': t.mainAgent + ' · ' + (project.projectName || projectRoot),
                    },
                    h('option', { value: '' }, mainCandidates.length === 0 ? t.mainAgentMissing : t.mainAgentUnbound),
                    mainCandidates.map((filename) => h('option', { key: filename, value: filename }, filename)),
                  ),
                ),
                mainExpanded ? evolutionEditor(projectRoot, 'main', mainId, mainEntry) : null,
              )

              var groupId = 'workspace:' + projectRoot
              var projectOpen = groups[groupId] !== false
              return h(
                'div',
                { key: projectRoot },
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-expanded': projectOpen,
                    onClick: () => setGroups((prev) => ({ ...prev, [groupId]: prev[groupId] === false })),
                    style: {
                      appearance: 'none',
                      width: '100%',
                      font: 'inherit',
                      color: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                      background: 'none',
                      border: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 4px 4px',
                      minWidth: 0,
                    },
                  },
                  h('span', { style: { flex: 'none' } }, chevron(projectOpen)),
                  h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 'none' } }, project.projectName || projectRoot),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: '11px',
                        padding: '1px 7px',
                        borderRadius: '999px',
                        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        flex: 'none',
                      },
                    },
                    String(agentRows.length),
                  ),
                  h(
                    'span',
                    { style: { marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                    project.projectRoot || '',
                  ),
                ),
                projectOpen
                  ? h(
                      'div',
                      null,
                      mainRow,
                      agentRows.length === 0
                        ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', padding: '4px' } }, t.empty)
                        : agentRows,
                    )
                  : null,
              )
            })

            body = h(
              'div',
              null,
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '8px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    fontSize: '13px',
                    flexWrap: 'wrap',
                  },
                },
                h('span', { style: { fontWeight: 600, flex: 'none' } }, t.scopeProjects),
                h(
                  'span',
                  {
                    style: {
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                    },
                  },
                  sourceText,
                ),
              ),
              note
                ? h(
                    'div',
                    {
                      role: 'status',
                      style: {
                        margin: '8px 0 0',
                        padding: '7px 9px',
                        borderRadius: '8px',
                        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        color: 'var(--dsw-alias-label-secondary, inherit)',
                        fontSize: '12px',
                        lineHeight: 1.4,
                        overflowWrap: 'anywhere',
                      },
                    },
                    note,
                  )
                : null,
              scanSource === 'workspaces'
                ? null
                : h(
                    'label',
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      },
                    },
                    h(
                      'span',
                      { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } },
                      t.scanFallback,
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                      h('input', {
                        type: 'text',
                        value: scanDir,
                        placeholder: 'D:\\trae',
                        spellCheck: false,
                        onChange: (event) => setScanDir(event.target.value),
                        style: {
                          flex: 1,
                          minWidth: 0,
                          font: 'inherit',
                          fontSize: '12px',
                          padding: '5px 8px',
                          borderRadius: '8px',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                          background: 'transparent',
                          color: 'inherit',
                        },
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: saveScanDir,
                          style: {
                            appearance: 'none',
                            font: 'inherit',
                            fontSize: '12px',
                            lineHeight: 1.5,
                            cursor: 'pointer',
                            border: '1px solid transparent',
                            borderRadius: '8px',
                            padding: '5px 12px',
                            background: 'var(--dsw-alias-label-primary, currentColor)',
                            color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                            flex: 'none',
                          },
                        },
                        t.scanSave,
                      ),
                    ),
                  ),
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
              builtin.length > 0
                ? h(
                    'div',
                    { style: { padding: '4px 0' } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0 2px', minWidth: 0 } },
                      h(
                        'button',
                        {
                          type: 'button',
                          'aria-expanded': groups.builtin !== false,
                          onClick: () => setGroups((prev) => ({ ...prev, builtin: prev.builtin === false })),
                          style: {
                            appearance: 'none',
                            font: 'inherit',
                            color: 'inherit',
                            background: 'none',
                            border: 0,
                            padding: '0',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            minWidth: 0,
                          },
                        },
                        h('span', { style: { flex: 'none' } }, chevron(groups.builtin !== false)),
                        h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 'none' } }, t.builtin),
                        h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.builtinHint),
                      ),
                      h('span', { style: { marginLeft: 'auto', flex: 'none', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } }, t.addTo),
                      addTargets.length > 0
                        ? h(
                            'select',
                            {
                              value: targetWorkspace,
                              onChange: (event) => setTargetWorkspace(event.target.value),
                              style: { ...selectStyles, width: '184px', flex: 'none' },
                              'aria-label': t.addTo,
                            },
                            addTargets.map((target) => h('option', { key: target.path, value: target.path }, target.title || target.path)),
                          )
                        : h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' } }, t.noWorkspace),
                    ),
                    groups.builtin === false
                      ? null
                      : builtin.map((agent) => {
                        var added = Boolean(selectedProject && (selectedProject.agents || []).some((item) => item.agentKey === agent.agentKey))
                        return h(
                        'div',
                        {
                          key: agent.agentKey,
                          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px' },
                        },
                        h('span', { style: { fontSize: '13px', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.agentKey),
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
                        h(
                          'button',
                          {
                            type: 'button',
                            disabled: !targetWorkspace || added,
                            title: added ? t.added : t.addTemplate,
                            'aria-label': (added ? t.added : t.addTemplate) + ' · ' + agent.agentKey,
                            onClick: () => addTemplate(targetWorkspace, agent.agentKey),
                            style: {
                              marginLeft: 'auto',
                              appearance: 'none',
                              width: '28px',
                              height: '28px',
                              padding: 0,
                              borderRadius: '8px',
                              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                              background: 'transparent',
                              color: 'inherit',
                              font: 'inherit',
                              fontSize: added ? '13px' : '18px',
                              lineHeight: 1,
                              cursor: !targetWorkspace || added ? 'default' : 'pointer',
                              opacity: !targetWorkspace || added ? 0.45 : 1,
                              flex: 'none',
                            },
                          },
                          added ? '✓' : '+',
                        ),
                      )
                    }),
                  )
                : null,
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
                      scanSource === 'workspaces' ? null : h('span', { style: { fontSize: '12px' } }, t.scanHint),
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
