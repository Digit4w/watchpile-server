-- Como a definição transforma o valor de `art` numa URL de imagem
-- (brief, 3.10, 01/09/2026).
--
-- **A arte do resultado de busca é EMPRESTADA, e por isso hotlinkada.** O
-- brief recusou hotlink para arte de obra, e as três razões dele — funcionar
-- offline e na LAN, não vazar a biblioteca, não depender da CDN daqui a dois
-- anos — são sobre a obra que a pessoa TEM. Um resultado de busca não tem
-- nenhuma dessas propriedades: ele vive segundos, só existe online (a consulta
-- precisa do provedor) e some quando a tela fecha. A exigência de offline
-- segue o OBJETO, não a tela.
--
-- O cache em disco continua na fila, para a arte da BIBLIOTECA, que é onde as
-- três razões valem — e a rota que o serve entra na frente do mesmo molde
-- declarado aqui, sem o cliente ficar sabendo.
--
-- **Nulável de propósito.** Provedor que já devolva URL absoluta não precisa
-- de molde; sem molde e com valor relativo, `art` volta nulo e a tela cai no
-- ladrilho com a inicial, em vez de desenhar uma imagem quebrada.

ALTER TABLE `providers` ADD `art_template` text;--> statement-breakpoint
-- `w342` e não o `w500` que o Yamtrack usa: a carta tem 133–150px de largura,
-- que numa tela 2× dá ~300 pixels reais. O tamanho mora no molde porque é
-- vocabulário da CDN do provedor, e a UI não pode ter que conhecê-lo.
UPDATE `providers`
SET `art_template` = 'https://image.tmdb.org/t/p/w342{path}'
WHERE `slug` = 'tmdb';
