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

-- ═══════════════════════════════════════════════════════════════════════════
-- Programa de referidos. Ver "Referidos" en CLAUDE.md.
--
-- ── Dos reglas que explican todo el diseno ──────────────────────────────────
--
-- 1. Un referido NO cuenta por instalar, sino por usar la app N dias DISTINTOS
--    (3 por defecto). Aqui sale dinero real, y pagar por instalacion se farmea:
--    levantar mil instalaciones falsas es barato, mantenerlas abriendo la app
--    tres dias distintos no lo es. Ademas el saldo pasa una cuarentena antes de
--    poder retirarse, que es la ventana para cazar el fraude antes de pagarlo.
--
-- 2. La cuenta es de la PERSONA, no del aparato. La primera version ato el
--    saldo al visitor_id del navegador y eso se cae solo: quien cambiara de
--    telefono o quisiera mirar sus ganancias desde la PC perderia el dinero.
--    De ahi `ref_users` (la cuenta) y `ref_devices` (los aparatos enlazados).
--
-- Para tener codigo hay que registrarse. Quien solo entra a ver el dolar sigue
-- siendo anonimo, como hasta ahora: la analitica no cambia.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `ref_users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`         VARCHAR(160) NOT NULL,
  `pass_hash`     VARCHAR(255) NOT NULL,          -- scrypt, mismo formato que el panel
  `verificado`    TINYINT(1)   NOT NULL DEFAULT 0,
  `code`          VARCHAR(12)  NOT NULL,          -- su codigo de referido
  `binance_email` VARCHAR(160) NULL,              -- a donde se le paga; se pide al retirar
  `saldo_espera`  DECIMAL(12,4) NOT NULL DEFAULT 0,  -- ganado, en cuarentena
  `saldo_libre`   DECIMAL(12,4) NOT NULL DEFAULT 0,  -- ya retirable
  `saldo_pagado`  DECIMAL(12,4) NOT NULL DEFAULT 0,  -- historico cobrado
  `total`         INT UNSIGNED NOT NULL DEFAULT 0,   -- gente que llego con su codigo
  `validos`       INT UNSIGNED NOT NULL DEFAULT 0,   -- de esos, los que ya cuentan
  `bloqueado`     TINYINT(1)   NOT NULL DEFAULT 0,   -- lo marca el panel ante fraude
  `nota`          VARCHAR(300) NULL,                  -- por que; uso interno
  `creado`        DATETIME     NOT NULL,
  `ultimo_acceso` DATETIME     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_libre` (`saldo_libre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aparatos enlazados a una cuenta. Es lo que permite que el mismo usuario mire
-- su saldo desde el telefono y desde la PC, y lo que conecta al referidor con
-- las visitas anonimas que ya se registraban.
CREATE TABLE IF NOT EXISTS `ref_devices` (
  `visitor_id` CHAR(32)     NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `enlazado`   DATETIME     NOT NULL,
  PRIMARY KEY (`visitor_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sesiones de usuario. En tabla, no en un JWT, por lo mismo que las del panel:
-- para poder cerrarlas de verdad. En la base solo vive el sha256 del token.
CREATE TABLE IF NOT EXISTS `ref_sessions` (
  `token_hash` CHAR(64)     NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `creada`     DATETIME     NOT NULL,
  `ultima`     DATETIME     NOT NULL,
  `expira`     DATETIME     NOT NULL,
  `ip`         VARCHAR(45)  NULL,
  `user_agent` VARCHAR(300) NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_user` (`user_id`),
  KEY `idx_expira` (`expira`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Enlaces de un solo uso que se mandan por correo: verificar la cuenta y
-- restablecer la contrasena. Igual que las sesiones, solo se guarda el hash.
CREATE TABLE IF NOT EXISTS `ref_tokens` (
  `token_hash` CHAR(64)     NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `tipo`       VARCHAR(12)  NOT NULL,           -- verificar | reset
  `expira`     DATETIME     NOT NULL,
  `usado`      TINYINT(1)   NOT NULL DEFAULT 0,
  `creado`     DATETIME     NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_user_tipo` (`user_id`, `tipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Intentos de entrada de los usuarios, para el bloqueo por fuerza bruta.
-- Aparte de admin_logins porque son cosas distintas y conviene poder mirar una
-- sin que la otra la ensucie.
CREATE TABLE IF NOT EXISTS `ref_logins` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip`         VARCHAR(45)  NOT NULL,
  `email`      VARCHAR(160) NULL,
  `ok`         TINYINT(1)   NOT NULL,
  `intento_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ip_fecha` (`ip`, `intento_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Una fila por persona referida. La PK es el aparato: un aparato se refiere una
-- sola vez en la vida, aunque le lleguen diez enlaces distintos.
CREATE TABLE IF NOT EXISTS `referrals` (
  `visitor_id`   CHAR(32)     NOT NULL,          -- el referido, sigue siendo anonimo
  `code`         VARCHAR(12)  NOT NULL,
  `user_id`      BIGINT UNSIGNED NOT NULL,       -- quien lo trajo
  `ip`           VARCHAR(45)  NULL,
  `country_code` CHAR(2)      NULL,
  `modo`         VARCHAR(12)  NULL,              -- navegador | pwa | apk
  `dias_activos` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ultimo_dia`   DATE         NULL,              -- impide sumar dos veces el mismo dia
  `validado`     TINYINT(1)   NOT NULL DEFAULT 0,
  `validado_at`  DATETIME     NULL,
  `madurado`     TINYINT(1)   NOT NULL DEFAULT 0,  -- salio de cuarentena, ya es retirable
  `sospechoso`   VARCHAR(60)  NULL,              -- motivo; si no es NULL no se paga solo
  `recompensa`   DECIMAL(12,4) NOT NULL DEFAULT 0,
  `user_agent`   VARCHAR(400) NULL,
  `creado`       DATETIME     NOT NULL,
  PRIMARY KEY (`visitor_id`),
  KEY `idx_user` (`user_id`, `validado`),
  KEY `idx_code` (`code`),
  KEY `idx_ip` (`ip`),
  KEY `idx_madurar` (`validado`, `madurado`, `validado_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Solicitudes de retiro. Se pagan a mano desde el panel: automatizarlo exigiria
-- claves de Binance CON permiso de retiro en un VPS compartido con sitios de
-- clientes, y si esa maquina se compromete se van los fondos.
CREATE TABLE IF NOT EXISTS `payouts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `code`        VARCHAR(12)  NOT NULL,
  `email`       VARCHAR(160) NOT NULL,           -- cuenta de Binance del usuario
  `monto`       DECIMAL(12,4) NOT NULL,
  `estado`      VARCHAR(12)  NOT NULL DEFAULT 'pendiente',  -- pendiente|pagado|rechazado
  `nota`        VARCHAR(300) NULL,
  `ip`          VARCHAR(45)  NULL,
  `pedido_at`   DATETIME     NOT NULL,
  `resuelto_at` DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_estado` (`estado`, `pedido_at`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
