-- Esquema de DolarPrice. Dos tablas: el estado actual (lecturas rapidas) y el
-- historico, en el que solo se inserta cuando el valor realmente cambia.

CREATE TABLE IF NOT EXISTS `rates_current` (
  `code`        VARCHAR(10)  NOT NULL,          -- USD, EUR, CNY, TRY, RUB, USDT
  `source`      VARCHAR(20)  NOT NULL,          -- BCV | BINANCE
  `rate`        DECIMAL(20,8) NOT NULL,
  `buy`         DECIMAL(20,8) NULL,             -- solo Binance
  `sell`        DECIMAL(20,8) NULL,             -- solo Binance
  `value_date`  DATE         NULL,              -- "fecha valor" publicada por el BCV
  `meta`        TEXT         NULL,              -- JSON con el detalle del calculo
  `changed_at`  DATETIME     NOT NULL,          -- ultima vez que el valor cambio
  `checked_at`  DATETIME     NOT NULL,          -- ultima vez que se consulto la fuente
  PRIMARY KEY (`code`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `rates_history` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(10)  NOT NULL,
  `source`      VARCHAR(20)  NOT NULL,
  `rate`        DECIMAL(20,8) NOT NULL,
  `buy`         DECIMAL(20,8) NULL,
  `sell`        DECIMAL(20,8) NULL,
  `value_date`  DATE         NULL,
  `fetched_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_code_source_fetched` (`code`, `source`, `fetched_at`),
  KEY `idx_fetched` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registro de cada corrida del capturador, para poder ver desde el panel
-- si una fuente lleva rato fallando.
CREATE TABLE IF NOT EXISTS `ingest_runs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source`      VARCHAR(20)  NOT NULL,
  `ok`          TINYINT(1)   NOT NULL,
  `message`     VARCHAR(500) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `ran_at`      DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_source_ran` (`source`, `ran_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Copia local de las noticias de verificavenezuela.org. Se sincroniza cada 20
-- minutos; si esa fuente falla, la pestana sigue mostrando esta copia.
CREATE TABLE IF NOT EXISTS `news_cache` (
  `id`           BIGINT UNSIGNED NOT NULL,      -- el id original de verificavenezuela
  `title`        VARCHAR(500) NOT NULL,
  `excerpt`      VARCHAR(500) NULL,
  `verdict`      VARCHAR(40)  NULL,             -- verificado, falso, enganoso...
  `category`     VARCHAR(80)  NULL,
  `image_url`    VARCHAR(600) NULL,
  `url`          VARCHAR(700) NOT NULL,
  `pinned`       TINYINT(1)   NOT NULL DEFAULT 0,
  `published_at` DATETIME     NULL,
  `synced_at`    DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_published` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════════════════════════════════════
-- Analitica propia. Ver el apartado "Panel de estadisticas" en CLAUDE.md.
--
-- La fuente de las visitas es el beacon del cliente, no el log de nginx ni un
-- hook del servidor: con el service worker instalado la cascara se sirve desde
-- cache y una visita repetida NO llega a tocar el servidor. Contar del lado del
-- servidor perderia justo a los usuarios mas fieles, que son los de la PWA y
-- los del APK.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `visits` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `visitor_id`  CHAR(32)     NOT NULL,          -- anonimo, vive en localStorage
  `session_id`  CHAR(32)     NOT NULL,          -- se renueva a los 30 min de inactividad
  `event`       VARCHAR(10)  NOT NULL DEFAULT 'view',  -- view | tab | fin
  `path`        VARCHAR(300) NOT NULL,
  `tab`         VARCHAR(30)  NULL,              -- inicio | monedas | noticias | historial
  `referrer`    VARCHAR(500) NULL,
  `ref_host`    VARCHAR(150) NULL,              -- el dominio ya extraido, para agrupar
  `ip`          VARCHAR(45)  NOT NULL,
  `country_code` CHAR(2)     NULL,
  `country`     VARCHAR(80)  NULL,
  `region`      VARCHAR(80)  NULL,
  `city`        VARCHAR(120) NULL,
  `browser`     VARCHAR(40)  NULL,
  `browser_ver` VARCHAR(20)  NULL,
  `os`          VARCHAR(40)  NULL,
  `os_ver`      VARCHAR(20)  NULL,
  `device`      VARCHAR(12)  NULL,              -- movil | tablet | escritorio
  `modo`        VARCHAR(12)  NULL,              -- navegador | pwa | apk
  `apk_instalado` TINYINT(1) NULL,             -- getInstalledRelatedApps: tiene el APK aunque entre por navegador
  `screen_w`    SMALLINT UNSIGNED NULL,
  `screen_h`    SMALLINT UNSIGNED NULL,
  `lang`        VARCHAR(20)  NULL,
  `user_agent`  VARCHAR(400) NULL,
  `duracion_ms` INT UNSIGNED NULL,              -- solo en el evento 'fin'
  `created_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_visitor` (`visitor_id`, `created_at`),
  KEY `idx_session` (`session_id`),
  KEY `idx_ip` (`ip`, `created_at`),
  KEY `idx_pais` (`country_code`, `created_at`),
  KEY `idx_ref` (`ref_host`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Resumen por visitante. Se podria calcular con GROUP BY sobre `visits`, pero
-- tenerlo aparte es lo que hace baratas las preguntas de "nuevos vs recurrentes"
-- y sobrevive a la purga de visitas antiguas.
CREATE TABLE IF NOT EXISTS `visitors` (
  `visitor_id`  CHAR(32)     NOT NULL,
  `primera`     DATETIME     NOT NULL,
  `ultima`      DATETIME     NOT NULL,
  `visitas`     INT UNSIGNED NOT NULL DEFAULT 1,
  `last_ip`     VARCHAR(45)  NULL,
  `country_code` CHAR(2)     NULL,
  `country`     VARCHAR(80)  NULL,
  `city`        VARCHAR(120) NULL,
  `device`      VARCHAR(12)  NULL,
  `browser`     VARCHAR(40)  NULL,
  `os`          VARCHAR(40)  NULL,
  `modo`        VARCHAR(12)  NULL,
  PRIMARY KEY (`visitor_id`),
  KEY `idx_ultima` (`ultima`),
  KEY `idx_primera` (`primera`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Trafico bruto, incluido lo que el beacon no ve (bots, peticiones a la API,
-- ficheros). Se acumula en memoria y se vuelca cada minuto: una fila por dia,
-- no una escritura por peticion.
CREATE TABLE IF NOT EXISTS `traffic_daily` (
  `dia`         DATE         NOT NULL,
  `peticiones`  INT UNSIGNED NOT NULL DEFAULT 0,
  `api`         INT UNSIGNED NOT NULL DEFAULT 0,
  `bots`        INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`dia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sesiones del panel. En tabla y no en un JWT para poder cerrarlas de verdad
-- desde el propio panel.
CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `token_hash`  CHAR(64)     NOT NULL,          -- sha256 del token de la cookie
  `creada`      DATETIME     NOT NULL,
  `ultima`      DATETIME     NOT NULL,
  `expira`      DATETIME     NOT NULL,
  `ip`          VARCHAR(45)  NULL,
  `user_agent`  VARCHAR(300) NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_expira` (`expira`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Intentos de entrada, para el bloqueo por fuerza bruta. En tabla y no en
-- memoria porque reiniciar el servicio no debe regalar intentos nuevos.
CREATE TABLE IF NOT EXISTS `admin_logins` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip`          VARCHAR(45)  NOT NULL,
  `ok`          TINYINT(1)   NOT NULL,
  `intento_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ip_fecha` (`ip`, `intento_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Descargas del APK. En tabla aparte y no en `visits` porque una descarga no
-- ejecuta JavaScript: no hay beacon ni visitor_id, solo la peticion al fichero.
-- Es la mitad de arriba del embudo: cuantos se lo bajaron. La mitad de abajo
-- --cuantos lo abren de verdad-- sale de `visits` con modo = 'apk'.
CREATE TABLE IF NOT EXISTS `apk_downloads` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip`          VARCHAR(45)  NOT NULL,
  `country_code` CHAR(2)     NULL,
  `country`     VARCHAR(80)  NULL,
  `city`        VARCHAR(120) NULL,
  `referrer`    VARCHAR(500) NULL,
  `user_agent`  VARCHAR(400) NULL,
  `created_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ajustes del panel: correo de entrada y hash de la contrasena.
--
-- Viven en la base y no en el .env para que se puedan cambiar desde el propio
-- panel sin entrar por SSH ni reiniciar el servicio. El .env sigue valiendo
-- como arranque: si esta tabla esta vacia se usa lo que haya alli, y en cuanto
-- se cambia la clave desde el panel manda esta tabla.
CREATE TABLE IF NOT EXISTS `admin_config` (
  `clave`       VARCHAR(40)  NOT NULL,          -- email | pass_hash
  `valor`       TEXT         NOT NULL,
  `actualizado` DATETIME     NOT NULL,
  PRIMARY KEY (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
