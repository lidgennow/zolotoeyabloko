# Быстрый старт — новый дашборд для клиента

## Шаг 1 — Создать репо из шаблона

1. Открыть github.com/mutiltity223/stomastrahan
2. Нажать зелёную кнопку **"Use this template"** → **"Create a new repository"**
3. Владелец — личный аккаунт `mutiltity223` (не организация!)
4. Имя репо — например `stom-kazan`
5. Видимость — **Private**
6. Нажать **"Create repository"**

## Шаг 2 — Скачать и настроить

В терминале:
```bash
git clone https://github.com/mutiltity223/ИМЯ-РЕПО.git
cd ИМЯ-РЕПО
```

Открыть **refresh.py** и поменять блок НАСТРОЙКИ (первые ~15 строк):
- `SHEET_ID` — ID таблицы Google Sheets нового клиента
- `AD_SPEND` — рекламные расходы по месяцам
- `MONTH_NAMES` — названия месяцев

Открыть **dashboard/index.html** и поменять две строки:
- строка ~5: `<title>` — название клиники
- строка ~73: `<h1>` — название клиники

## Шаг 3 — Залить на GitHub

```bash
git add .
git commit -m "init new client"
git push
```

При запросе пароля — вставить Personal Access Token (с галочками `repo` + `workflow`).

## Шаг 4 — Подключить Netlify

1. netlify.com → **"Add new project"** → **GitHub**
2. Выбрать новый репо
3. Build settings:
   - Base directory: (пусто)
   - Build command: (пусто)
   - Publish directory: `dashboard`
4. Deploy

## Шаг 5 — Запустить первое обновление данных

1. GitHub → репо → вкладка **Actions**
2. Workflow **"Обновление данных"** → **"Run workflow"**
3. Дождаться зелёной галочки (~1 мин)

Готово. Данные будут обновляться автоматически каждые 30 минут.
